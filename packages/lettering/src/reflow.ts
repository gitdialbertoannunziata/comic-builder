import type { LoadedFont } from "./font.js";
import type { TextRun, Emphasis } from "@comic-builder/core";

interface Token {
  text: string;
  em?: Emphasis | undefined;
  kind: "word" | "space";
}

export interface LineToken {
  text: string;
  em?: Emphasis | undefined;
}

export type Line = LineToken[];

/** Spezza i text run sugli spazi, preservando gli spazi come token a sé e l'enfasi per parola. */
function tokenize(runs: TextRun[]): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    const parts = run.t.split(/(\s+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      const isSpace = /^\s+$/.test(part);
      tokens.push(isSpace ? { text: part, kind: "space" } : { text: part, em: run.em, kind: "word" });
    }
  }
  return tokens;
}

function measure(font: LoadedFont, text: string, fontSizePx: number): number {
  return font.getAdvanceWidth(text, fontSizePx);
}

/**
 * Word-wrap greedy con misurazione reale dei glifi (§8.1): nessuna stima di
 * caratteri medi, la larghezza di ogni token viene dal font effettivamente usato.
 */
function greedyWrap(tokens: Token[], font: LoadedFont, fontSizePx: number, maxWidthPx: number): Line[] {
  const lines: Line[] = [];
  let current: LineToken[] = [];
  let currentWidth = 0;

  const flush = () => {
    // Non porta lo spazio finale in una riga chiusa.
    while (current.length > 0 && /^\s+$/.test(current[current.length - 1]!.text)) {
      current.pop();
    }
    if (current.length > 0) lines.push(current);
    current = [];
    currentWidth = 0;
  };

  for (const token of tokens) {
    const width = measure(font, token.text, fontSizePx);

    if (token.kind === "space") {
      if (current.length === 0) continue; // niente spazi a inizio riga
      current.push({ text: token.text });
      currentWidth += width;
      continue;
    }

    if (currentWidth + width > maxWidthPx && current.length > 0) {
      flush();
    }
    current.push({ text: token.text, em: token.em });
    currentWidth += width;
  }
  flush();

  return lines;
}

function lastLineWordCount(lines: Line[]): number {
  const last = lines[lines.length - 1];
  if (!last) return 0;
  return last.filter((t) => !/^\s+$/.test(t.text)).length;
}

/**
 * Wrap con bilanciamento (§8.1: "evitare l'ultima riga con una parola sola").
 * Riduce progressivamente la larghezza massima di prova: una riga penultima più
 * corta spinge una parola in più sull'ultima riga. Euristica, non ottimizzazione
 * tipografica completa (Knuth-Plass) — coerente con l'ambizione dichiarata nel piano.
 */
export function wrapText(
  runs: TextRun[],
  font: LoadedFont,
  fontSizePx: number,
  maxWidthPx: number,
): Line[] {
  const tokens = tokenize(runs);
  const base = greedyWrap(tokens, font, fontSizePx, maxWidthPx);

  if (base.length < 2 || lastLineWordCount(base) !== 1) return base;

  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const trialWidth = maxWidthPx * (1 - i * 0.02); // -2% per tentativo, fino a -20%
    if (trialWidth <= 0) break;
    const trial = greedyWrap(tokens, font, fontSizePx, trialWidth);
    if (trial.length === base.length && lastLineWordCount(trial) > 1) {
      return trial;
    }
  }

  return base;
}

export function lineWidth(line: Line, font: LoadedFont, fontSizePx: number): number {
  return measure(font, line.map((t) => t.text).join(""), fontSizePx);
}

export function blockWidth(lines: Line[], font: LoadedFont, fontSizePx: number): number {
  return Math.max(0, ...lines.map((l) => lineWidth(l, font, fontSizePx)));
}
