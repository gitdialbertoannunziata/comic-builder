import type { ProjectDoc } from "../document/projectDoc.js";
import type { Balloon } from "../schema/balloon.js";
import type { NewRevision } from "./revisionCommands.js";

/**
 * Trova e sostituisci sul testo di un capitolo (§10.3).
 *
 * Non è una modifica "silenziosa": ogni battuta cambiata entra nel changelog
 * come correzione applicata, con origine `find-replace`. Così `balloon.rev`
 * e changelog restano allineati (§10.2), e un "sostituisci tutto" sbagliato
 * si ritrova e si annulla come ogni altra revisione.
 */
export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  /** Dove cercare: il testo delle battute, l'azione dei pannelli, o entrambi. */
  scope?: "balloons" | "actions" | "both";
}

export interface FindMatch {
  pageId: string;
  panelId: string;
  /** null per un'azione di pannello. */
  balloonId: string | null;
  before: string;
  after: string;
  count: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findPattern(find: string, options: FindOptions = {}): RegExp | null {
  if (find.length === 0) return null;
  const core = escapeRegExp(find);
  // Confini di parola che conoscono le lettere accentate: \b di JavaScript no,
  // e «è» spezzerebbe una parola a metà.
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${core}(?![\\p{L}\\p{N}_])` : core;
  return new RegExp(source, `gu${options.matchCase ? "" : "i"}`);
}

const plain = (b: Balloon) => b.text.map((r) => r.t).join("");

export function findMatches(doc: ProjectDoc, chapterId: string, find: string, replace: string, options: FindOptions = {}): FindMatch[] {
  const pattern = findPattern(find, options);
  if (!pattern) return [];
  const scope = options.scope ?? "balloons";
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  const matches: FindMatch[] = [];
  const count = (text: string) => text.match(pattern)?.length ?? 0;
  // `replace` è testo, non un modello: un «$1» scritto dall'utente resta «$1».
  const substitute = (text: string) => text.replace(pattern, () => replace);

  for (const pageId of chapter?.pages ?? []) {
    const page = doc.pages[pageId];
    if (!page) continue;
    for (const panel of page.panels) {
      if (scope !== "balloons" && count(panel.action) > 0) {
        matches.push({ pageId, panelId: panel.id, balloonId: null, before: panel.action, after: substitute(panel.action), count: count(panel.action) });
      }
      if (scope === "actions") continue;
      for (const balloon of panel.balloons) {
        const text = plain(balloon);
        const n = count(text);
        if (n > 0) matches.push({ pageId, panelId: panel.id, balloonId: balloon.id, before: text, after: substitute(text), count: n });
      }
    }
  }
  // Una sostituzione che svuoterebbe una battuta non si propone: si toglie il balloon, non lo si svuota.
  return matches.filter((m) => m.after !== m.before && (m.balloonId === null || m.after.trim().length > 0));
}

/** Le sostituzioni come correzioni, pronte per `revision.add` e `revision.apply`. */
export function matchesAsRevisions(matches: readonly FindMatch[]): NewRevision[] {
  return matches.map((m) => ({
    origin: "find-replace",
    kind: m.balloonId ? "text" : "action",
    panel: m.panelId,
    balloon: m.balloonId,
    speaker: null,
    from: m.before,
    to: m.after,
    source_line: null,
  }));
}
