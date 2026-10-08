import type { ProjectDoc } from "../document/projectDoc.js";
import type { RevisionEntry } from "../schema/revisions.js";

/**
 * La memoria delle revisioni.
 *
 * Una correzione vale per il suo balloon; ciò che se ne impara vale per la
 * serie. L'autore lo dice con una riga (`lesson`) sulla voce da cui nasce, e
 * quella riga arriva allo spoglio di ogni capitolo insieme alle regole della
 * serie — così l'errore corretto nel capitolo 3 non si ripresenta nel 4.
 *
 * È una scelta, non un automatismo: «Non c'è più niente» → «Non è rimasto
 * niente» non insegna nulla al capitolo dopo, «Elio non dà mai del lei» sì, e
 * solo chi scrive sa distinguere.
 */
export interface SeriesLesson {
  chapterId: string;
  /** La voce del changelog da cui la regola nasce. */
  id: string;
  text: string;
}

export function seriesLessons(doc: ProjectDoc, maxChars = 1500): SeriesLesson[] {
  const order = new Map(doc.chapters.chapters.map((c) => [c.id, c.number]));
  const chapters = Object.keys(doc.revisions).sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
  const seen = new Set<string>();
  const all: SeriesLesson[] = [];
  for (const chapterId of chapters) {
    for (const entry of doc.revisions[chapterId]!.entries) {
      const text = entry.lesson?.trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      all.push({ chapterId, id: entry.id, text });
    }
  }
  // Oltre il limite restano le più recenti: sono quelle che l'autore ha in mente.
  let size = 0;
  let from = all.length;
  while (from > 0 && size + all[from - 1]!.text.length <= maxChars) size += all[--from]!.text.length;
  return all.slice(from);
}

/** Una proposta di regola da cui partire: l'autore la riscrive in ciò che vale davvero per la serie. */
export function suggestLesson(entry: Pick<RevisionEntry, "kind" | "field" | "from" | "to" | "speaker">): string {
  const to = entry.to?.trim() ?? "";
  const from = entry.from?.trim() ?? "";
  switch (entry.kind) {
    case "text":
    case "action":
      return from && to ? `Non «${from}» ma «${to}».` : to;
    case "set":
      if (entry.field === "speaker") return `Questa battuta è di ${to || "nessuno (didascalia)"}, non di ${from || "nessuno"}.`;
      if (entry.field === "balloon_type") return `Battute come questa sono «${to}», non «${from}».`;
      return from && to ? `Non «${from}» ma «${to}».` : to;
    case "add":
      return to ? `Non tralasciare battute come «${to}».` : "";
    case "remove":
      return from ? `Niente battute come «${from}».` : "";
    case "note":
      return to;
  }
}
