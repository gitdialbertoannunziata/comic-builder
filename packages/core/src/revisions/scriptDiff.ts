import type { ProjectDoc } from "../document/projectDoc.js";
import type { Balloon } from "../schema/balloon.js";
import type { Panel } from "../schema/panel.js";
import type { SourceRef } from "../schema/common.js";
import type { NewRevision } from "./revisionCommands.js";
import { normalizeForCompare, refFromName } from "./readable.js";

/**
 * Diff del copione e provenienza (§10.1, passo 1).
 *
 * Ogni pannello sa da quali righe del copione nasce (`source`). Quando lo
 * sceneggiatore rimanda il capitolo modificato, un diff per righe dice quali
 * parti sono cambiate e quindi quali pannelli sono toccati. Dentro quei
 * pannelli, le battute scritte `NOME: testo` si riconoscono con certezza e
 * diventano correzioni; le righe di prosa diventano note, perché l'azione di
 * un pannello è un riassunto e tradurla in automatico sarebbe inventare.
 */

/** Una parte cambiata: righe [oldStart, oldEnd) del vecchio sostituite da [newStart, newEnd) del nuovo. Numeri da 1. */
export interface Hunk {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Diff per righe, algoritmo di Myers (O((N+M)·D)): veloce quando le
 * differenze sono poche, che è il caso normale di una revisione. Restituisce
 * le parti cambiate, già raggruppate.
 */
export function diffLines(oldText: string, newText: string): Hunk[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Ricostruzione a ritroso: le coppie di righe uguali (x, y), indici da 0.
  const equal: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      equal.push([x - 1, y - 1]);
      x--;
      y--;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    equal.push([x - 1, y - 1]);
    x--;
    y--;
  }
  equal.reverse();

  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const [ea, eb] of [...equal, [n, m] as [number, number]]) {
    if (ea > ai || eb > bi) hunks.push({ oldStart: ai + 1, oldEnd: ea + 1, newStart: bi + 1, newEnd: eb + 1 });
    ai = ea + 1;
    bi = eb + 1;
  }
  return hunks;
}

/**
 * Per ogni riga del vecchio, la riga corrispondente nel nuovo. Una riga
 * cambiata o tolta va sulla posizione dove sta la sua parte nel nuovo: la
 * provenienza di un pannello resta ancorata al punto giusto del copione.
 */
export function lineMap(oldText: string, newText: string): (line: number) => number {
  const hunks = diffLines(oldText, newText);
  return (line: number) => {
    let shift = 0;
    for (const h of hunks) {
      if (line < h.oldStart) break;
      if (line < h.oldEnd) {
        // Dentro una parte cambiata: stessa posizione relativa, entro la parte nuova.
        const within = line - h.oldStart;
        return Math.max(h.newStart, Math.min(h.newEnd - 1, h.newStart + within));
      }
      shift += h.newEnd - h.newStart - (h.oldEnd - h.oldStart);
    }
    return Math.max(1, line + shift);
  };
}

export function remapSource(source: SourceRef, map: (line: number) => number): SourceRef {
  const from = map(source.from_line);
  const to = Math.max(from, map(source.to_line));
  return from === source.from_line && to === source.to_line ? source : { ...source, from_line: from, to_line: to };
}

/** Una battuta di copione: `NOME: testo`. Stessa convenzione dello spoglio euristico. */
const DIALOGUE = /^\s*([A-ZÀ-Ü][A-Za-zÀ-ü' _.]{0,30}?)\s*:\s*(.+)$/;

function parseDialogue(line: string): { speaker: string; text: string } | null {
  const match = DIALOGUE.exec(line);
  return match ? { speaker: refFromName(match[1]!), text: match[2]!.trim() } : null;
}

const plain = (b: Balloon) => b.text.map((r) => r.t).join("");

export interface TouchedPanel {
  pageId: string;
  panel: Panel;
  /** Le parti cambiate che lo riguardano. */
  hunks: Hunk[];
}

export interface ScriptImpact {
  hunks: Hunk[];
  touched: TouchedPanel[];
  /** Parti cambiate che non cadono in nessun pannello: materiale nuovo, da impaginare. */
  unassigned: Hunk[];
  corrections: NewRevision[];
}

function overlaps(source: SourceRef, h: Hunk): boolean {
  if (h.oldEnd > h.oldStart) return h.oldStart <= source.to_line && h.oldEnd - 1 >= source.from_line;
  // Righe solo aggiunte: toccano il pannello se cadono dentro il suo intervallo.
  return h.oldStart > source.from_line && h.oldStart <= source.to_line;
}

export function scriptImpact(doc: ProjectDoc, chapterId: string, newText: string): ScriptImpact {
  const oldText = doc.scripts[chapterId] ?? "";
  const hunks = diffLines(oldText, newText);
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  const panels: Array<{ pageId: string; panel: Panel }> = [];
  for (const pageId of chapter?.pages ?? []) {
    const page = doc.pages[pageId];
    if (page) for (const panel of page.panels) panels.push({ pageId, panel });
  }

  const touched: TouchedPanel[] = [];
  const assigned = new Set<Hunk>();
  for (const { pageId, panel } of panels) {
    if (!panel.source) continue;
    const mine = hunks.filter((h) => overlaps(panel.source!, h));
    if (mine.length === 0) continue;
    mine.forEach((h) => assigned.add(h));
    touched.push({ pageId, panel, hunks: mine });
  }

  const corrections: NewRevision[] = [];
  const used = new Set<string>();
  for (const { panel, hunks: mine } of touched) {
    for (const h of mine) {
      const olds = oldLines.slice(h.oldStart - 1, h.oldEnd - 1);
      const news = newLines.slice(h.newStart - 1, h.newEnd - 1);
      const pairs = Math.max(olds.length, news.length);
      const source = panel.source!;
      for (let i = 0; i < pairs; i++) {
        // Una parte cambiata può attraversare più pannelli: ogni riga va al
        // solo pannello che la contiene, o le correzioni si duplicano. Le
        // righe in più del nuovo seguono l'ultima riga vecchia della parte.
        const oldLine = i < olds.length ? h.oldStart + i : olds.length > 0 ? h.oldEnd - 1 : null;
        if (oldLine !== null && (oldLine < source.from_line || oldLine > source.to_line)) continue;
        const before = olds[i] !== undefined ? parseDialogue(olds[i]!) : null;
        const after = news[i] !== undefined ? parseDialogue(news[i]!) : null;
        const sourceLine = h.newStart + Math.min(i, Math.max(0, news.length - 1));
        const match = before
          ? panel.balloons.find((b) => !used.has(b.id) && b.speaker.ref === before.speaker && normalizeForCompare(plain(b)) === normalizeForCompare(before.text))
          : undefined;

        if (before && after && match && before.speaker === after.speaker) {
          used.add(match.id);
          if (normalizeForCompare(after.text) !== normalizeForCompare(before.text)) {
            corrections.push({ origin: "script", kind: "text", panel: panel.id, balloon: match.id, speaker: null, from: plain(match), to: after.text, source_line: sourceLine });
          }
        } else if (before && match && !after) {
          used.add(match.id);
          corrections.push({ origin: "script", kind: "remove", panel: panel.id, balloon: match.id, speaker: null, from: plain(match), to: null, source_line: h.oldStart + i });
        } else if (after && !before) {
          corrections.push({ origin: "script", kind: "add", panel: panel.id, balloon: null, speaker: after.speaker, from: null, to: after.text, source_line: sourceLine });
        } else if (olds[i]?.trim() || news[i]?.trim()) {
          // Prosa cambiata, o una battuta che non si riesce ad attribuire con
          // certezza: la si mostra, e decide l'autore.
          corrections.push({
            origin: "script",
            kind: "note",
            panel: panel.id,
            balloon: null,
            speaker: null,
            from: olds[i]?.trim() || null,
            to: news[i]?.trim() || null,
            source_line: sourceLine,
          });
        }
      }
    }
  }

  return { hunks, touched, unassigned: hunks.filter((h) => !assigned.has(h)), corrections };
}

/** Il documento con la provenienza di pannelli e beat riallineata al copione nuovo. */
export function remapProvenance(doc: ProjectDoc, chapterId: string, newText: string): ProjectDoc {
  const map = lineMap(doc.scripts[chapterId] ?? "", newText);
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  const pages = { ...doc.pages };
  for (const pageId of chapter?.pages ?? []) {
    const page = pages[pageId];
    if (!page) continue;
    let changed = false;
    const panels = page.panels.map((panel) => {
      if (!panel.source) return panel;
      const source = remapSource(panel.source, map);
      if (source === panel.source) return panel;
      changed = true;
      return { ...panel, source };
    });
    if (changed) pages[pageId] = { ...page, panels };
  }

  const sceneIds = new Set((chapter?.pages ?? []).flatMap((id) => doc.pages[id]?.panels.map((p) => p.scene_id) ?? []));
  let scenesChanged = false;
  const scenes = doc.scenes.scenes.map((scene) => {
    if (!sceneIds.has(scene.id)) return scene;
    let changed = false;
    const beats = scene.beats.map((beat) => {
      if (!beat.source) return beat;
      const source = remapSource(beat.source, map);
      if (source === beat.source) return beat;
      changed = true;
      return { ...beat, source };
    });
    if (!changed) return scene;
    scenesChanged = true;
    return { ...scene, beats };
  });

  return { ...doc, pages, scenes: scenesChanged ? { ...doc.scenes, scenes } : doc.scenes };
}
