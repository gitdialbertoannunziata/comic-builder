import { SceneSchema, beatId, issue, type Scene, type ValidationIssue } from "@comic-builder/core";
import { BreakdownSchema, breakdownJsonSchema, BREAKDOWN_SCHEMA_NAME, type BreakdownScene } from "./breakdownSchema.js";
import { breakdownSystemPrompt, breakdownUserPrompt } from "./prompt.js";
import { LlmError, LlmTruncatedError, type LlmService } from "./service.js";

export interface BreakdownInput {
  llm: LlmService;
  /** Il capitolo in prosa. */
  script: string;
  /** Percorso del file, per la provenienza (§10.1). */
  scriptFile: string;
  /** Prefisso degli id di scena: gli id si derivano, non si chiedono al modello (§5.3). */
  scenePrefix?: string;
  /**
   * Caratteri di copione per richiesta. Il JSON dello spoglio è più lungo del
   * testo che descrive, e i fornitori tagliano la risposta a un limite di
   * token (DeepSeek: 8192): un capitolo intero lo supera. Si divide ai titoli
   * di scena. Default 6000, prudente per i limiti più bassi.
   */
  chunkChars?: number;
  /** Avanzamento, per chi aspetta: «parte 2 di 4». */
  onProgress?: (progress: { done: number; total: number }) => void;
}

export interface BreakdownResult {
  scenes: Scene[];
  /** Cosa non tornava nell'output del modello e come è stato sistemato. */
  issues: ValidationIssue[];
  meta: { service: string; model: string; durationMs: number };
}

function sceneIdFor(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

/**
 * Converte una scena proposta dal modello in una scena del progetto,
 * riparando ciò che è riparabile. Gli id si assegnano qui, derivati: al
 * modello non si chiedono proprio, perché un id inventato non sarebbe stabile
 * e la stabilità è ciò su cui si regge il merge dei re-run (§10.3).
 */
function toScene(
  raw: BreakdownScene,
  index: number,
  prefix: string,
  scriptFile: string,
  scriptLines: number,
  issues: ValidationIssue[],
): Scene {
  const id = sceneIdFor(prefix, index);

  const beats = raw.beats.map((beat, beatIndex) => {
    const path = `scenes[${id}].beats[${beatIndex}]`;

    // La provenienza arriva dal modello ed è la cosa che sbaglia più spesso:
    // si tiene solo se sta davvero dentro lo script, altrimenti si azzera.
    // Meglio nessuna provenienza che una che punta alla riga sbagliata, perché
    // a valle guiderà le revisioni dello sceneggiatore (§10.1).
    let source: Scene["beats"][number]["source"] = null;
    const { from_line: from, to_line: to } = beat;
    if (from >= 1 && to >= from && to <= scriptLines) {
      source = { file: scriptFile, from_line: from, to_line: to };
    } else {
      issues.push(
        issue(
          "warning",
          "breakdown.source-out-of-range",
          `Righe ${from}–${to} fuori dallo script (${scriptLines} righe): provenienza scartata`,
          path,
        ),
      );
    }

    // Chi parla in vignetta deve esserci: il lint lo tratta come errore
    // (Appendice A), salvo le battute fuori campo e le didascalie, che per
    // definizione non hanno un corpo nell'inquadratura.
    let characters = beat.characters?.map((c) => ({ ref: c.ref.trim(), expression: c.expression.trim() })) ?? null;
    if (characters) {
      for (const line of beat.lines) {
        if (!line.speaker || line.type === "offpanel" || line.type === "caption") continue;
        if (characters.some((c) => c.ref === line.speaker)) continue;
        characters = [...characters, { ref: line.speaker, expression: "" }];
        issues.push(
          issue(
            "info",
            "breakdown.speaker-in-panel",
            `"${line.speaker}" parla in vignetta ma non era fra i presenti del beat: aggiunto`,
            `${path}.characters`,
          ),
        );
      }
    }

    return {
      id: beatId(id, beatIndex + 1),
      function: beat.function,
      summary: beat.summary.trim(),
      intense: beat.intense,
      source,
      lines: beat.lines.map((line) => ({
        speaker: line.speaker,
        text: line.text.trim(),
        type: line.type,
      })),
      characters,
      mood: beat.mood,
      props: beat.props.map((p) => p.trim()).filter((p) => p.length > 0),
    };
  });

  // Uno speaker che non compare fra i personaggi della scena renderebbe il
  // documento invalido a valle (il lint lo segnala come errore, Appendice A):
  // si aggiunge invece di lasciare che esploda dopo.
  const declared = new Set(raw.characters.map((c) => c.trim()).filter((c) => c.length > 0));
  const declare = (ref: string, why: string) => {
    if (declared.has(ref)) return;
    declared.add(ref);
    issues.push(issue("info", "breakdown.speaker-added", `"${ref}" ${why}: aggiunto`, `scenes[${id}].characters`));
  };
  for (const beat of beats) {
    for (const line of beat.lines) {
      if (line.speaker) declare(line.speaker, "parla ma non era fra i personaggi della scena");
    }
    for (const character of beat.characters ?? []) {
      declare(character.ref, "compare in una vignetta ma non era fra i personaggi della scena");
    }
  }

  return SceneSchema.parse({
    id,
    title: raw.title.trim() || `Scena ${index + 1}`,
    location: raw.location.trim() || "non specificato",
    time_of_day: raw.time_of_day.trim() || "non specificata",
    characters: [...declared],
    mood: raw.mood,
    lighting: raw.lighting,
    style_ref: null,
    beats,
  });
}

/**
 * Spoglio: capitolo in prosa → scene e beat (§12, F1).
 *
 * È l'unico punto non deterministico della catena. Tutto ciò che sta a valle —
 * camera dalla tabella, template dal catalogo, id, impaginazione — è
 * deterministico, quindi l'incertezza è confinata qui e viene filtrata subito:
 * lo schema valida, e ciò che si può riparare si ripara segnalandolo.
 */
/** Una parte del copione, con la sua posizione nel copione intero. */
export interface ScriptChunk {
  text: string;
  /** Numero (da 1) della prima riga nel copione intero. */
  firstLine: number;
  /** Vero se la parte comincia a metà di una scena: le sue prime righe continuano la parte prima. */
  continuation: boolean;
}

/** Stessa convenzione dello spoglio euristico: titoli markdown o righe INT./EST. */
const SCENE_HEADING = /^\s*(#{1,3}\s+\S|(INT|EST|INT\.\/EST)[.\s])/i;

function linesToChunk(lines: readonly string[], start: number, end: number, continuation: boolean): ScriptChunk {
  return { text: lines.slice(start, end).join("\n"), firstLine: start + 1, continuation };
}

/**
 * Divide il copione in parti di al più `maxChars`, ai titoli di scena. Una
 * scena più lunga del limite da sola si divide ai paragrafi, e le parti
 * successive sono marcate come continuazione — lo spoglio le ricuce.
 */
export function splitScript(script: string, maxChars: number): ScriptChunk[] {
  const lines = script.split("\n");
  const starts = [0];
  lines.forEach((line, i) => {
    if (i > 0 && SCENE_HEADING.test(line)) starts.push(i);
  });
  const scenes = starts.map((start, i) => [start, starts[i + 1] ?? lines.length] as const);
  const size = (a: number, b: number) => lines.slice(a, b).join("\n").length;

  const chunks: ScriptChunk[] = [];
  let open: [number, number] | null = null;
  const flush = () => {
    if (open) chunks.push(linesToChunk(lines, open[0], open[1], false));
    open = null;
  };

  for (const [a, b] of scenes) {
    if (size(a, b) > maxChars) {
      flush();
      // Scena troppo lunga: si divide ai paragrafi (righe vuote).
      let partStart = a;
      let lastBreak = -1;
      for (let i = a; i < b; i++) {
        if (lines[i]!.trim() === "") lastBreak = i;
        if (size(partStart, i + 1) > maxChars && lastBreak > partStart) {
          chunks.push(linesToChunk(lines, partStart, lastBreak, partStart !== a));
          partStart = lastBreak;
          lastBreak = -1;
        }
      }
      chunks.push(linesToChunk(lines, partStart, b, partStart !== a));
      continue;
    }
    if (open && size(open[0], b) > maxChars) flush();
    open = open ? [open[0], b] : [a, b];
  }
  flush();
  return chunks.filter((c) => c.text.trim().length > 0);
}

/** Divide una parte in due vicino a metà: a un titolo di scena se c'è, altrimenti a un paragrafo. Null se non si può. */
export function halveChunk(chunk: ScriptChunk): [ScriptChunk, ScriptChunk] | null {
  const lines = chunk.text.split("\n");
  const middle = lines.length / 2;
  const candidates = (test: (line: string, i: number) => boolean) =>
    lines.map((line, i) => (i > 0 && i < lines.length - 1 && test(line, i) ? i : -1)).filter((i) => i > 0);
  const nearest = (list: number[]) => list.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  const heading = nearest(candidates((line) => SCENE_HEADING.test(line)));
  const blank = nearest(candidates((line) => line.trim() === ""));
  const at = heading ?? blank;
  if (at === undefined) return null;
  return [
    { text: lines.slice(0, at).join("\n"), firstLine: chunk.firstLine, continuation: chunk.continuation },
    { text: lines.slice(at).join("\n"), firstLine: chunk.firstLine + at, continuation: heading === undefined },
  ];
}

interface PartResult {
  scenes: BreakdownScene[];
  continuation: boolean;
  model: string;
  durationMs: number;
}

/** Le parti, ricucite: una parte che continua una scena ne aggiunge i beat invece di aprirne un'altra. */
function stitch(parts: readonly PartResult[]): BreakdownScene[] {
  const scenes: BreakdownScene[] = [];
  for (const part of parts) {
    const [first, ...rest] = part.scenes;
    const previous = scenes[scenes.length - 1];
    if (part.continuation && first && previous) {
      scenes[scenes.length - 1] = {
        ...previous,
        characters: [...new Set([...previous.characters, ...first.characters])],
        beats: [...previous.beats, ...first.beats],
      };
      scenes.push(...rest);
    } else {
      scenes.push(...part.scenes);
    }
  }
  return scenes;
}

export async function breakdownScript(input: BreakdownInput): Promise<BreakdownResult> {
  const issues: ValidationIssue[] = [];
  const scriptLines = input.script.split("\n").length;
  const known = new Set<string>();
  const parts: PartResult[] = [];
  const queue = splitScript(input.script, input.chunkChars ?? 6000);
  let done = 0;

  // Ogni parte è una richiesta. Se il fornitore la tronca comunque, la si
  // dimezza e si riprova: il capitolo si spoglia lo stesso, solo in più giri.
  while (queue.length > 0) {
    const chunk = queue.shift()!;
    input.onProgress?.({ done, total: done + queue.length + 1 });
    let response;
    try {
      response = await input.llm.complete({
        system: breakdownSystemPrompt(),
        user: breakdownUserPrompt(chunk.text, {
          firstLine: chunk.firstLine,
          knownCharacters: [...known].sort(),
          part: { index: done, total: done + queue.length + 1, continuation: chunk.continuation },
        }),
        schema: breakdownJsonSchema(),
        schemaName: BREAKDOWN_SCHEMA_NAME,
      });
    } catch (error) {
      if (error instanceof LlmTruncatedError) {
        const halves = halveChunk(chunk);
        if (halves) {
          issues.push(issue("info", "breakdown.split", `Righe ${chunk.firstLine}–${chunk.firstLine + chunk.text.split("\n").length - 1}: risposta troncata, divise in due richieste`, "breakdown"));
          queue.unshift(...halves);
          continue;
        }
        throw new LlmTruncatedError(
          `Risposta troncata anche su un solo paragrafo (righe da ${chunk.firstLine}): alza il limite di token del fornitore.`,
          input.llm.name,
        );
      }
      throw error;
    }

    const parsed = BreakdownSchema.safeParse(response.data);
    if (!parsed.success) {
      // Nessuna riparazione possibile: se la forma non regge, non c'è nulla da
      // cui partire. Meglio fallire chiaro che costruire un documento inventato.
      throw new LlmError(
        `Lo spoglio non è conforme allo schema${parts.length > 0 || queue.length > 0 ? ` (righe da ${chunk.firstLine})` : ""}: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
        input.llm.name,
      );
    }
    for (const scene of parsed.data.scenes) {
      scene.characters.forEach((c) => known.add(c));
      scene.beats.forEach((b) => b.lines.forEach((l) => l.speaker && known.add(l.speaker)));
    }
    parts.push({ scenes: parsed.data.scenes, continuation: chunk.continuation, model: response.meta.model, durationMs: response.meta.durationMs });
    done++;
  }
  input.onProgress?.({ done, total: done });

  const prefix = input.scenePrefix ?? "s";
  const scenes = stitch(parts).map((raw, i) => toScene(raw, i, prefix, input.scriptFile, scriptLines, issues));

  return {
    scenes,
    issues,
    meta: {
      service: input.llm.name,
      model: parts[parts.length - 1]?.model ?? "",
      durationMs: parts.reduce((n, p) => n + p.durationMs, 0),
    },
  };
}
