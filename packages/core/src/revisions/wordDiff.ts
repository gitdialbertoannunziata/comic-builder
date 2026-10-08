import { diffSequences } from "./scriptDiff.js";

/**
 * Il prima e il dopo di una correzione, parola per parola: ciò che resta,
 * ciò che esce, ciò che entra. Su una battuta di venti parole in cui ne
 * cambia una, leggere due paragrafi interi per trovarla è lavoro inutile.
 */
export interface WordSegment {
  kind: "same" | "del" | "ins";
  text: string;
}

const tokens = (text: string): string[] => text.match(/\s+|\S+/g) ?? [];

export function diffWords(from: string, to: string): WordSegment[] {
  const a = tokens(from);
  const b = tokens(to);
  const out: WordSegment[] = [];
  const push = (kind: WordSegment["kind"], text: string) => {
    if (text.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let ai = 0;
  for (const hunk of diffSequences(a, b)) {
    push("same", a.slice(ai, hunk.oldStart - 1).join(""));
    push("del", a.slice(hunk.oldStart - 1, hunk.oldEnd - 1).join(""));
    push("ins", b.slice(hunk.newStart - 1, hunk.newEnd - 1).join(""));
    ai = hunk.oldEnd - 1;
  }
  push("same", a.slice(ai).join(""));
  return out;
}
