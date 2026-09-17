import type { LlmService, LlmRequest, LlmResponse } from "./service.js";
import type { Breakdown, BreakdownBeat, BreakdownScene } from "./breakdownSchema.js";

/**
 * Spoglio euristico deterministico, senza alcun modello.
 *
 * Non è una risposta preconfezionata: legge davvero il testo, quindi tutta la
 * catena di F1 gira offline e ripetibile ("serve mockabile per i test
 * offline", §11.1). Ha anche un secondo uso, meno ovvio: è il **livello di
 * riferimento** del gate di §12.2. La domanda "lo spoglio richiede meno
 * correzioni di quante ne servirebbero a mano" diventa verificabile solo se
 * esiste qualcosa di stupido da battere, altrimenti si finisce a giudicare
 * l'output di un modello contro un'impressione.
 */

const TIME_WORDS = [
  "alba",
  "mattina",
  "mattino",
  "mezzogiorno",
  "pomeriggio",
  "tramonto",
  "sera",
  "notte",
] as const;

/** `NOME: battuta` — la forma in cui il dialogo si scrive in una sceneggiatura. */
const DIALOGUE = /^\s*([A-ZÀ-Ü][A-Za-zÀ-ü' _.]{0,30}?)\s*:\s*(.+)$/;

function refFor(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface RawBlock {
  lines: string[];
  from: number;
  to: number;
}

interface RawScene {
  heading: string | null;
  blocks: RawBlock[];
}

/** Divide su titoli markdown o su righe tutte maiuscole in stile sceneggiatura. */
function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,3}\s+\S/.test(trimmed)) return true;
  if (/^(INT|EST|INT\.\/EST)[.\s]/i.test(trimmed)) return true;
  return false;
}

function splitScenes(script: string): RawScene[] {
  const lines = script.split("\n");
  const scenes: RawScene[] = [];
  let current: RawScene = { heading: null, blocks: [] };
  let block: RawBlock | null = null;

  const closeBlock = () => {
    if (block && block.lines.some((l) => l.trim().length > 0)) current.blocks.push(block);
    block = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (isHeading(line)) {
      closeBlock();
      if (current.blocks.length > 0 || current.heading) scenes.push(current);
      current = { heading: line.replace(/^#{1,3}\s*/, "").trim(), blocks: [] };
      return;
    }

    if (line.trim().length === 0) {
      closeBlock();
      return;
    }

    if (!block) block = { lines: [], from: lineNumber, to: lineNumber };
    block.lines.push(line);
    block.to = lineNumber;
  });

  closeBlock();
  if (current.blocks.length > 0 || current.heading) scenes.push(current);

  return scenes.filter((s) => s.blocks.length > 0);
}

function timeOfDay(text: string): string {
  const lower = text.toLowerCase();
  const found = TIME_WORDS.find((word) => lower.includes(word));
  return found ?? "non specificata";
}

function beatFrom(block: RawBlock, index: number, total: number): BreakdownBeat {
  const lines: BreakdownBeat["lines"] = [];
  const prose: string[] = [];

  for (const line of block.lines) {
    const match = DIALOGUE.exec(line);
    if (match?.[1] && match[2]) {
      lines.push({ speaker: refFor(match[1]), text: match[2].trim() });
    } else {
      prose.push(line.trim());
    }
  }

  // Per un beat di sole battute il riassunto non ripete le battute: quelle
  // finiscono già nei balloon, e ripeterle riempirebbe il campo azione di un
  // doppione. Si dice invece il fatto visivo che l'euristica conosce davvero,
  // cioè chi parla. Resta grezzo di proposito — è il livello da battere.
  const speakers = [...new Set(lines.map((l) => l.speaker).filter((s): s is string => s !== null))];
  const summary =
    prose.join(" ").trim() ||
    (speakers.length > 1
      ? `${speakers.join(" e ")} si parlano`
      : speakers.length === 1
        ? `${speakers[0]} parla`
        : "");

  // Euristica dichiarata: apertura, chiusura, dialogo, altrimenti azione.
  // Volutamente grossolana — è il livello da battere, non un concorrente.
  const fn: BreakdownBeat["function"] =
    lines.length > 0 ? "dialogue" : index === 0 ? "establish" : index === total - 1 ? "close" : "action";

  return {
    function: fn,
    summary: summary.slice(0, 300),
    intense: false,
    lines,
    from_line: block.from,
    to_line: block.to,
  };
}

function sceneFrom(raw: RawScene, index: number): BreakdownScene {
  const beats = raw.blocks.map((block, i) => beatFrom(block, i, raw.blocks.length));
  const allText = raw.blocks.flatMap((b) => b.lines).join(" ");
  const characters = [...new Set(beats.flatMap((b) => b.lines.map((l) => l.speaker)))].filter(
    (ref): ref is string => ref !== null,
  );

  return {
    title: raw.heading ?? `Scena ${index + 1}`,
    location: raw.heading ?? "non specificato",
    time_of_day: timeOfDay(`${raw.heading ?? ""} ${allText}`),
    characters,
    beats,
  };
}

/**
 * Il prompt consegna le righe numerate (`12\ttesto`) preceduto da un
 * preambolo. L'euristica lavora sul testo vero, quindi lo ricostruisce: così
 * accetta indifferentemente uno script grezzo o il prompt completo, e i numeri
 * di riga che produce restano quelli dello script originale.
 */
function unnumber(text: string): string {
  const lines = text.split("\n");
  const numbered = lines
    .map((line) => /^(\d+)\t(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null);

  if (numbered.length < lines.length / 2) return text;

  const restored: string[] = [];
  for (const match of numbered) {
    const lineNumber = Number(match[1]);
    while (restored.length < lineNumber - 1) restored.push("");
    restored[lineNumber - 1] = match[2] ?? "";
  }
  return restored.join("\n");
}

export function heuristicBreakdown(input: string): Breakdown {
  const script = unnumber(input);
  const scenes = splitScenes(script).map(sceneFrom);
  if (scenes.length > 0) return { scenes };

  // Uno script senza struttura riconoscibile resta una scena sola: meglio un
  // documento povero ma valido che un errore che blocca la catena.
  return {
    scenes: [
      {
        title: "Scena 1",
        location: "non specificato",
        time_of_day: "non specificata",
        characters: [],
        beats: [
          {
            function: "establish",
            summary: script.trim().slice(0, 300) || "(script vuoto)",
            intense: false,
            lines: [],
            from_line: 1,
            to_line: Math.max(1, script.split("\n").length),
          },
        ],
      },
    ],
  };
}

export class MockLlmService implements LlmService {
  readonly name = "mock";
  /** Non c'è un modello da vincolare: l'output è costruito, quindi conforme per costruzione. */
  readonly constraint = "grammar" as const;

  complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    return Promise.resolve({
      data: heuristicBreakdown(request.user),
      meta: { model: "euristico", durationMs: Date.now() - started },
    });
  }
}
