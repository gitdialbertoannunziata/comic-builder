import type { ProjectDoc } from "../document/projectDoc.js";
import type { Balloon } from "../schema/balloon.js";
import type { Panel } from "../schema/panel.js";
import type { RevisionEntry, RevisionsDoc } from "../schema/revisions.js";
import type { Command } from "../editor/commands.js";

/**
 * Accettare e rifiutare correzioni (§10.1, passi 3–5).
 *
 * Accettare una correzione è modificare il documento *e* segnarla come
 * applicata, nello stesso passo: così changelog e `balloon.rev` non possono
 * divergere (§10.2), e un Ctrl+Z annulla entrambe le cose insieme.
 */

/** Una correzione come arriva da un import, prima di avere id e stato. */
export type NewRevision = Omit<RevisionEntry, "id" | "at" | "by" | "status" | "rev" | "resolved_at" | "resolved_by">;

export class RevisionConflict extends Error {}

export function emptyRevisions(chapterId: string): RevisionsDoc {
  return { schema: 1, chapter_id: chapterId, script: null, entries: [] };
}

function nextRevisionNumber(entries: readonly RevisionEntry[]): number {
  let highest = 0;
  for (const e of entries) {
    const n = Number(/^r-(\d+)$/.exec(e.id)?.[1] ?? 0);
    if (n > highest) highest = n;
  }
  return highest + 1;
}

interface Located {
  pageId: string;
  panel: Panel;
  balloon: Balloon | null;
}

export function locate(doc: ProjectDoc, entry: Pick<RevisionEntry, "panel" | "balloon">): Located | null {
  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      if (entry.balloon) {
        const balloon = panel.balloons.find((b) => b.id === entry.balloon);
        if (balloon) return { pageId: page.id, panel, balloon };
      } else if (panel.id === entry.panel) {
        return { pageId: page.id, panel, balloon: null };
      }
    }
  }
  return null;
}

const plain = (b: Balloon) => b.text.map((r) => r.t).join("");

/**
 * Perché una correzione non si può applicare così com'è, o null se si può.
 * Il caso tipico: il testo "prima" della correzione non è più quello del
 * balloon, perché l'autore l'ha già cambiato. Sovrascriverlo in silenzio
 * sarebbe esattamente l'errore che una revisione tracciata deve evitare.
 */
export function revisionConflict(doc: ProjectDoc, entry: RevisionEntry): string | null {
  if (entry.status !== "open") return `già ${entry.status === "applied" ? "applicata" : "rifiutata"}`;
  if (entry.kind === "note") return null;
  const found = locate(doc, entry);
  if (!found) return entry.balloon ? `il balloon ${entry.balloon} non esiste più` : `il pannello ${entry.panel} non esiste più`;
  switch (entry.kind) {
    case "text":
      if (!found.balloon) return "manca il balloon";
      if (entry.to === null || entry.to.length === 0) return "testo nuovo vuoto: per togliere il balloon serve una correzione di rimozione";
      return plain(found.balloon) === entry.from ? null : `il testo è cambiato nel frattempo («${plain(found.balloon)}»)`;
    case "action":
      return found.panel.action === entry.from ? null : "l'azione è cambiata nel frattempo";
    case "remove":
      return found.balloon ? null : "il balloon non c'è più";
    case "add":
      return entry.to && entry.to.length > 0 ? null : "battuta vuota";
  }
}

export function addRevisions(doc: ProjectDoc, chapterId: string, incoming: readonly NewRevision[], by: string, at: string): ProjectDoc {
  const current = doc.revisions[chapterId] ?? emptyRevisions(chapterId);
  // La stessa correzione importata due volte (lo stesso file riletto) non si duplica.
  const key = (e: Pick<RevisionEntry, "kind" | "panel" | "balloon" | "from" | "to">) => JSON.stringify([e.kind, e.panel, e.balloon, e.from, e.to]);
  const open = new Set(current.entries.filter((e) => e.status === "open").map(key));
  let n = nextRevisionNumber(current.entries);
  const added: RevisionEntry[] = [];
  for (const entry of incoming) {
    if (open.has(key(entry))) continue;
    open.add(key(entry));
    added.push({ ...entry, id: `r-${String(n++).padStart(4, "0")}`, at, by, status: "open", rev: null, resolved_at: null, resolved_by: null });
  }
  if (added.length === 0) return doc;
  return { ...doc, revisions: { ...doc.revisions, [chapterId]: { ...current, entries: [...current.entries, ...added] } } };
}

type Apply = (doc: ProjectDoc, command: Command) => ProjectDoc;

export function applyRevisions(doc: ProjectDoc, chapterId: string, ids: readonly string[], by: string, at: string, apply: Apply): ProjectDoc {
  const revs = doc.revisions[chapterId];
  if (!revs) throw new RevisionConflict(`Nessuna revisione per il capitolo ${chapterId}`);
  const wanted = new Set(ids);
  const conflicts = revs.entries.filter((e) => wanted.has(e.id)).map((e) => [e, revisionConflict(doc, e)] as const).filter(([, c]) => c !== null);
  if (conflicts.length > 0) {
    throw new RevisionConflict(conflicts.map(([e, c]) => `${e.id}: ${c}`).join("; "));
  }

  let next = doc;
  const resolved = new Map<string, Partial<RevisionEntry>>();
  for (const entry of revs.entries) {
    if (!wanted.has(entry.id)) continue;
    const found = locate(next, entry)!;
    switch (entry.kind) {
      case "text":
        next = apply(next, { type: "balloon.text", pageId: found.pageId, balloonId: entry.balloon!, text: [{ t: entry.to! }] });
        resolved.set(entry.id, { rev: locate(next, entry)!.balloon!.rev });
        break;
      case "action":
        next = apply(next, { type: "panel.update", pageId: found.pageId, panelId: found.panel.id, patch: { action: entry.to ?? "" } });
        resolved.set(entry.id, {});
        break;
      case "remove":
        next = apply(next, { type: "balloon.remove", pageId: found.pageId, balloonId: entry.balloon! });
        resolved.set(entry.id, {});
        break;
      case "add": {
        const before = new Set(found.panel.balloons.map((b) => b.id));
        next = apply(next, { type: "balloon.add", pageId: found.pageId, panelId: found.panel.id, text: [{ t: entry.to! }] });
        const panel = locate(next, { panel: found.panel.id, balloon: null })!.panel;
        const created = panel.balloons.find((b) => !before.has(b.id))!;
        if (entry.speaker) {
          next = apply(next, { type: "balloon.update", pageId: found.pageId, balloonId: created.id, patch: { speaker: { ref: entry.speaker, visible: true } } });
        }
        // La voce ora punta al balloon che ha creato: le correzioni successive lo ritrovano.
        resolved.set(entry.id, { balloon: created.id, rev: created.rev });
        break;
      }
      case "note":
        resolved.set(entry.id, {});
        break;
    }
  }

  return withEntries(next, chapterId, (e) =>
    resolved.has(e.id) ? { ...e, ...resolved.get(e.id), status: "applied", resolved_at: at, resolved_by: by } : e,
  );
}

export function rejectRevisions(doc: ProjectDoc, chapterId: string, ids: readonly string[], by: string, at: string): ProjectDoc {
  const wanted = new Set(ids);
  return withEntries(doc, chapterId, (e) => (wanted.has(e.id) && e.status === "open" ? { ...e, status: "rejected", resolved_at: at, resolved_by: by } : e));
}

function withEntries(doc: ProjectDoc, chapterId: string, change: (e: RevisionEntry) => RevisionEntry): ProjectDoc {
  const revs = doc.revisions[chapterId];
  if (!revs) return doc;
  const entries = revs.entries.map(change);
  if (entries.every((e, i) => e === revs.entries[i])) return doc;
  return { ...doc, revisions: { ...doc.revisions, [chapterId]: { ...revs, entries } } };
}
