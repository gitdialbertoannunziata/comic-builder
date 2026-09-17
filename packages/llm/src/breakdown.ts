import { SceneSchema, beatId, issue, type Scene, type ValidationIssue } from "@comic-builder/core";
import { BreakdownSchema, breakdownJsonSchema, BREAKDOWN_SCHEMA_NAME, type BreakdownScene } from "./breakdownSchema.js";
import { breakdownSystemPrompt, breakdownUserPrompt } from "./prompt.js";
import { LlmError, type LlmService } from "./service.js";

export interface BreakdownInput {
  llm: LlmService;
  /** Il capitolo in prosa. */
  script: string;
  /** Percorso del file, per la provenienza (§10.1). */
  scriptFile: string;
  /** Prefisso degli id di scena: gli id si derivano, non si chiedono al modello (§5.3). */
  scenePrefix?: string;
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

    return {
      id: beatId(id, beatIndex + 1),
      function: beat.function,
      summary: beat.summary.trim(),
      intense: beat.intense,
      source,
      lines: beat.lines.map((line) => ({
        speaker: line.speaker,
        text: line.text.trim(),
        type: "speech" as const,
      })),
    };
  });

  // Uno speaker che non compare fra i personaggi della scena renderebbe il
  // documento invalido a valle (il lint lo segnala come errore, Appendice A):
  // si aggiunge invece di lasciare che esploda dopo.
  const declared = new Set(raw.characters.map((c) => c.trim()).filter((c) => c.length > 0));
  for (const beat of beats) {
    for (const line of beat.lines) {
      if (line.speaker && !declared.has(line.speaker)) {
        declared.add(line.speaker);
        issues.push(
          issue(
            "info",
            "breakdown.speaker-added",
            `"${line.speaker}" parla ma non era fra i personaggi della scena: aggiunto`,
            `scenes[${id}].characters`,
          ),
        );
      }
    }
  }

  return SceneSchema.parse({
    id,
    title: raw.title.trim() || `Scena ${index + 1}`,
    location: raw.location.trim() || "non specificato",
    time_of_day: raw.time_of_day.trim() || "non specificata",
    characters: [...declared],
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
export async function breakdownScript(input: BreakdownInput): Promise<BreakdownResult> {
  const issues: ValidationIssue[] = [];
  const scriptLines = input.script.split("\n").length;

  const response = await input.llm.complete({
    system: breakdownSystemPrompt(),
    user: breakdownUserPrompt(input.script),
    schema: breakdownJsonSchema(),
    schemaName: BREAKDOWN_SCHEMA_NAME,
  });

  const parsed = BreakdownSchema.safeParse(response.data);
  if (!parsed.success) {
    // Nessuna riparazione possibile: se la forma non regge, non c'è nulla da
    // cui partire. Meglio fallire chiaro che costruire un documento inventato.
    throw new LlmError(
      `Lo spoglio non è conforme allo schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
      input.llm.name,
    );
  }

  const prefix = input.scenePrefix ?? "s";
  const scenes = parsed.data.scenes.map((raw, i) =>
    toScene(raw, i, prefix, input.scriptFile, scriptLines, issues),
  );

  return {
    scenes,
    issues,
    meta: { service: input.llm.name, model: response.meta.model, durationMs: response.meta.durationMs },
  };
}
