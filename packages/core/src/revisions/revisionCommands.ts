import type { ProjectDoc } from "../document/projectDoc.js";
import { BalloonTypeSchema, type Balloon, type TextRun } from "../schema/balloon.js";
import type { Panel } from "../schema/panel.js";
import type { RevisionEntry, RevisionsDoc } from "../schema/revisions.js";
import type { Command } from "../editor/commands.js";
import { normalizeForCompare } from "./readable.js";

/**
 * Accettare e rifiutare correzioni (§10.1, passi 3–5).
 *
 * Accettare una correzione è modificare il documento *e* segnarla come
 * applicata, nello stesso passo: così changelog e `balloon.rev` non possono
 * divergere (§10.2), e un Ctrl+Z annulla entrambe le cose insieme.
 */

/**
 * Una correzione come arriva da un import, prima di avere id e stato. I
 * bersagli sopra il pannello, il campo di un `set` e la lezione sono
 * facoltativi: chi non li dà ottiene null.
 */
export type NewRevision = Pick<RevisionEntry, "origin" | "kind" | "panel" | "balloon" | "speaker" | "from" | "to" | "source_line"> &
  Partial<Pick<RevisionEntry, "page" | "scene" | "field" | "lesson">>;

export class RevisionConflict extends Error {}

export function emptyRevisions(chapterId: string): RevisionsDoc {
  return { schema: 1, chapter_id: chapterId, script: null, entries: [] };
}

/** A cosa si riferisce una voce: il bersaglio più stretto che dichiara. */
export type RevisionScope = "balloon" | "panel" | "page" | "scene" | "chapter";

export function revisionScope(entry: Pick<RevisionEntry, "panel" | "balloon"> & Partial<Pick<RevisionEntry, "page" | "scene">>): RevisionScope {
  if (entry.balloon) return "balloon";
  if (entry.panel) return "panel";
  if (entry.page) return "page";
  if (entry.scene) return "scene";
  return "chapter";
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

/**
 * Il pannello (e il balloon) di una voce. Con `chapterId` si cerca solo nelle
 * pagine di quel capitolo: una revisione è del suo capitolo, e un id uguale
 * altrove non la riguarda.
 */
export function locate(doc: ProjectDoc, entry: Pick<RevisionEntry, "panel" | "balloon">, chapterId?: string): Located | null {
  const pageIds = chapterId === undefined ? Object.keys(doc.pages) : (doc.chapters.chapters.find((c) => c.id === chapterId)?.pages ?? []);
  for (const pageId of pageIds) {
    const page = doc.pages[pageId];
    if (!page) continue;
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

/** Uguali a meno di ciò che un elaboratore di testi cambia da solo (virgolette, spazi, puntini). */
const same = (a: string | null, b: string | null) => normalizeForCompare(a ?? "") === normalizeForCompare(b ?? "");

/**
 * Il testo nuovo dentro i run di prima: ciò che non cambia tiene la sua
 * enfasi, e il tratto cambiato la eredita solo se stava tutto dentro un run.
 * Correggere una parola non deve togliere il grassetto a quella accanto.
 */
export function retext(runs: readonly TextRun[], text: string): TextRun[] {
  const old = runs.map((r) => r.t).join("");
  if (old === text) return [...runs];
  let prefix = 0;
  while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < text.length - prefix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  const end = old.length - suffix;

  const out: TextRun[] = [];
  const push = (t: string, em: TextRun["em"]) => {
    if (t.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.em === em) out[out.length - 1] = { ...last, t: last.t + t };
    else out.push(em ? { t, em } : { t });
  };
  const middle = text.slice(prefix, text.length - suffix);
  let placed = false;
  let start = 0;
  for (const run of runs) {
    const stop = start + run.t.length;
    push(run.t.slice(0, Math.max(0, Math.min(run.t.length, prefix - start))), run.em);
    if (!placed && stop > prefix) {
      // Dentro questo run: tutto il tratto cambiato, o un'inserzione che non cade sul suo bordo.
      const inside = prefix < end ? start <= prefix && end <= stop : start < prefix && prefix < stop;
      push(middle, inside ? run.em : undefined);
      placed = true;
    }
    push(run.t.slice(Math.max(0, Math.min(run.t.length, end - start))), run.em);
    start = stop;
  }
  if (!placed) push(middle, undefined);
  return out.length > 0 ? out : [{ t: text }];
}

/** Il valore attuale di ciò che una voce vuole cambiare, come testo. */
function currentValue(found: Located, entry: Pick<RevisionEntry, "kind" | "field">): string | null {
  switch (entry.kind) {
    case "text":
      return found.balloon ? plain(found.balloon) : null;
    case "action":
      return found.panel.action;
    case "set":
      switch (entry.field) {
        case "setting":
          return found.panel.setting;
        case "continuity_notes":
          return found.panel.continuity_notes;
        case "speaker":
          return found.balloon ? (found.balloon.speaker.ref ?? "") : null;
        case "balloon_type":
          return found.balloon ? found.balloon.type : null;
        default:
          return null;
      }
    default:
      return null;
  }
}

interface Obstacle {
  reason: string;
  /** Solo il «prima» non corrisponde più: chi decide può applicarla lo stesso. */
  stale: boolean;
}

function obstacle(doc: ProjectDoc, entry: RevisionEntry, chapterId?: string): Obstacle | null {
  const hard = (reason: string): Obstacle => ({ reason, stale: false });
  if (entry.status !== "open") return hard(`già ${entry.status === "applied" ? "applicata" : "rifiutata"}`);
  if (entry.kind === "note") return null;
  const found = locate(doc, entry, chapterId);
  if (!found) return hard(entry.balloon ? `il balloon ${entry.balloon} non esiste più` : `il pannello ${entry.panel} non esiste più`);
  switch (entry.kind) {
    case "text": {
      if (!found.balloon) return hard("manca il balloon");
      if (entry.to === null || entry.to.length === 0) return hard("testo nuovo vuoto: per togliere il balloon serve una correzione di rimozione");
      return same(plain(found.balloon), entry.from) ? null : { reason: `il testo è cambiato nel frattempo («${plain(found.balloon)}»)`, stale: true };
    }
    case "action":
      return same(found.panel.action, entry.from) ? null : { reason: "l'azione è cambiata nel frattempo", stale: true };
    case "set": {
      if (!entry.field) return hard("manca il campo da cambiare");
      const value = currentValue(found, entry);
      if (value === null) return hard("manca il balloon");
      if (entry.field === "balloon_type" && !BalloonTypeSchema.safeParse(entry.to).success) return hard(`«${entry.to ?? ""}» non è un tipo di battuta`);
      return same(value, entry.from) ? null : { reason: `il valore è cambiato nel frattempo («${value}»)`, stale: true };
    }
    case "remove":
      return found.balloon ? null : hard("il balloon non c'è più");
    case "add":
      return entry.to && entry.to.length > 0 ? null : hard("battuta vuota");
  }
}

/**
 * Perché una correzione non si può applicare così com'è, o null se si può.
 * Il caso tipico: il testo "prima" della correzione non è più quello del
 * balloon, perché l'autore l'ha già cambiato. Sovrascriverlo in silenzio
 * sarebbe esattamente l'errore che una revisione tracciata deve evitare.
 */
export function revisionConflict(doc: ProjectDoc, entry: RevisionEntry, chapterId?: string): string | null {
  return obstacle(doc, entry, chapterId)?.reason ?? null;
}

/** Il conflitto è solo un «prima» superato: si può applicare lo stesso, sapendo cosa si sovrascrive. */
export function canForceRevision(doc: ProjectDoc, entry: RevisionEntry, chapterId?: string): boolean {
  return obstacle(doc, entry, chapterId)?.stale === true;
}

type Key = Pick<RevisionEntry, "kind" | "panel" | "balloon" | "from" | "to"> & Partial<Pick<RevisionEntry, "page" | "scene" | "field">>;
const key = (e: Key) => JSON.stringify([e.kind, e.field ?? null, e.panel, e.balloon, e.page ?? null, e.scene ?? null, e.from, e.to]);

/**
 * Cosa c'è di nuovo in un import: la stessa correzione riletta dallo stesso
 * file non si duplica, e una già rifiutata non torna a chiedere la stessa
 * decisione. Chi la vuole davvero la riapre dallo storico.
 */
export function partitionIncoming(
  doc: ProjectDoc,
  chapterId: string,
  incoming: readonly NewRevision[],
): { fresh: NewRevision[]; alreadyOpen: NewRevision[]; alreadyRejected: NewRevision[] } {
  const entries = doc.revisions[chapterId]?.entries ?? [];
  const open = new Set(entries.filter((e) => e.status === "open").map(key));
  const rejected = new Set(entries.filter((e) => e.status === "rejected").map(key));
  const fresh: NewRevision[] = [];
  const alreadyOpen: NewRevision[] = [];
  const alreadyRejected: NewRevision[] = [];
  for (const entry of incoming) {
    const k = key(entry);
    if (open.has(k)) alreadyOpen.push(entry);
    else if (rejected.has(k)) alreadyRejected.push(entry);
    else {
      open.add(k);
      fresh.push(entry);
    }
  }
  return { fresh, alreadyOpen, alreadyRejected };
}

export interface AddOptions {
  /** Aggiunge anche ciò che era già stato rifiutato: per le voci che l'autore scrive o ordina di persona. */
  again?: boolean;
}

export function addRevisions(doc: ProjectDoc, chapterId: string, incoming: readonly NewRevision[], by: string, at: string, options: AddOptions = {}): ProjectDoc {
  const current = doc.revisions[chapterId] ?? emptyRevisions(chapterId);
  const parts = partitionIncoming(doc, chapterId, incoming);
  const wanted = options.again ? [...parts.fresh, ...parts.alreadyRejected] : parts.fresh;
  let n = nextRevisionNumber(current.entries);
  const added: RevisionEntry[] = wanted.map((entry) => ({
    page: null,
    scene: null,
    field: null,
    lesson: null,
    ...entry,
    id: `r-${String(n++).padStart(4, "0")}`,
    at,
    by,
    status: "open",
    rev: null,
    resolved_at: null,
    resolved_by: null,
    resolution: null,
    replaced: null,
  }));
  if (added.length === 0) return doc;
  return { ...doc, revisions: { ...doc.revisions, [chapterId]: { ...current, entries: [...current.entries, ...added] } } };
}

/** Le voci aperte che dicono la stessa cosa di queste: chi le ordina di nuovo intende anche loro. */
export function openMatching(doc: ProjectDoc, chapterId: string, incoming: readonly NewRevision[]): string[] {
  const keys = new Set(incoming.map(key));
  return (doc.revisions[chapterId]?.entries ?? []).filter((e) => e.status === "open" && keys.has(key(e))).map((e) => e.id);
}

type Apply = (doc: ProjectDoc, command: Command) => ProjectDoc;

export interface ApplyOptions {
  /** Applica anche le voci il cui «prima» non corrisponde più, registrando cosa si è sovrascritto. */
  force?: boolean;
  /** Cosa si è fatto: per le note, che da sole non cambiano nulla. */
  resolution?: string | null;
}

export function applyRevisions(doc: ProjectDoc, chapterId: string, ids: readonly string[], by: string, at: string, apply: Apply, options: ApplyOptions = {}): ProjectDoc {
  const revs = doc.revisions[chapterId];
  if (!revs) throw new RevisionConflict(`Nessuna revisione per il capitolo ${chapterId}`);
  const wanted = new Set(ids);
  const conflicts = revs.entries
    .filter((e) => wanted.has(e.id))
    .map((e) => [e, obstacle(doc, e, chapterId)] as const)
    .filter(([, o]) => o !== null && !(options.force && o.stale));
  if (conflicts.length > 0) {
    throw new RevisionConflict(conflicts.map(([e, o]) => `${e.id}: ${o!.reason}`).join("; "));
  }

  let next = doc;
  const resolved = new Map<string, Partial<RevisionEntry>>();
  for (const entry of revs.entries) {
    if (!wanted.has(entry.id)) continue;
    if (entry.kind === "note") {
      resolved.set(entry.id, {});
      continue;
    }
    const found = locate(next, entry, chapterId)!;
    // Una voce forzata dice cosa ha sovrascritto: è la traccia che il conflitto non ha lasciato.
    const value = currentValue(found, entry);
    const replaced = value !== null && !same(value, entry.from) ? { replaced: value } : {};
    switch (entry.kind) {
      case "text":
        next = apply(next, { type: "balloon.text", pageId: found.pageId, balloonId: entry.balloon!, text: retext(found.balloon!.text, entry.to!) });
        resolved.set(entry.id, { ...replaced, rev: locate(next, entry, chapterId)!.balloon!.rev });
        break;
      case "action":
        next = apply(next, { type: "panel.update", pageId: found.pageId, panelId: found.panel.id, patch: { action: entry.to ?? "" } });
        resolved.set(entry.id, replaced);
        break;
      case "set":
        switch (entry.field) {
          case "setting":
            next = apply(next, { type: "panel.update", pageId: found.pageId, panelId: found.panel.id, patch: { setting: entry.to ?? "" } });
            break;
          case "continuity_notes":
            next = apply(next, { type: "panel.update", pageId: found.pageId, panelId: found.panel.id, patch: { continuity_notes: entry.to ?? "" } });
            break;
          case "speaker":
            next = apply(next, { type: "balloon.update", pageId: found.pageId, balloonId: entry.balloon!, patch: { speaker: { ...found.balloon!.speaker, ref: entry.to || null } } });
            break;
          case "balloon_type":
            next = apply(next, { type: "balloon.update", pageId: found.pageId, balloonId: entry.balloon!, patch: { type: BalloonTypeSchema.parse(entry.to) } });
            break;
        }
        resolved.set(entry.id, replaced);
        break;
      case "remove":
        next = apply(next, { type: "balloon.remove", pageId: found.pageId, balloonId: entry.balloon! });
        resolved.set(entry.id, {});
        break;
      case "add": {
        const before = new Set(found.panel.balloons.map((b) => b.id));
        next = apply(next, { type: "balloon.add", pageId: found.pageId, panelId: found.panel.id, text: [{ t: entry.to! }] });
        const panel = locate(next, { panel: found.panel.id, balloon: null }, chapterId)!.panel;
        const created = panel.balloons.find((b) => !before.has(b.id))!;
        if (entry.speaker) {
          next = apply(next, { type: "balloon.update", pageId: found.pageId, balloonId: created.id, patch: { speaker: { ref: entry.speaker, visible: true } } });
        }
        // La voce ora punta al balloon che ha creato: le correzioni successive lo ritrovano.
        resolved.set(entry.id, { balloon: created.id, rev: created.rev });
        break;
      }
    }
  }

  const resolution = options.resolution?.trim() || null;
  return withEntries(next, chapterId, (e) =>
    resolved.has(e.id) ? { ...e, ...resolved.get(e.id), status: "applied", resolved_at: at, resolved_by: by, resolution } : e,
  );
}

export function rejectRevisions(doc: ProjectDoc, chapterId: string, ids: readonly string[], by: string, at: string, resolution: string | null = null): ProjectDoc {
  const wanted = new Set(ids);
  return withEntries(doc, chapterId, (e) =>
    wanted.has(e.id) && e.status === "open" ? { ...e, status: "rejected", resolved_at: at, resolved_by: by, resolution: resolution?.trim() || null } : e,
  );
}

/** Cambia ciò che una voce aperta propone, prima di decidere: lo sceneggiatore aveva ragione a metà. */
export function editRevision(doc: ProjectDoc, chapterId: string, id: string, to: string): ProjectDoc {
  const entry = doc.revisions[chapterId]?.entries.find((e) => e.id === id);
  if (!entry) throw new RevisionConflict(`Nessuna voce ${id}`);
  if (entry.status !== "open") throw new RevisionConflict(`${id} è già decisa: riaprila per cambiarla`);
  if (entry.kind === "remove") throw new RevisionConflict("Una rimozione non ha un testo da cambiare");
  return withEntries(doc, chapterId, (e) => (e.id === id ? { ...e, to } : e));
}

/**
 * Riapre una decisione: una voce rifiutata, o una nota chiusa. Una correzione
 * applicata non si riapre — il documento è già cambiato: si ripristina.
 */
export function reopenRevisions(doc: ProjectDoc, chapterId: string, ids: readonly string[]): ProjectDoc {
  const wanted = new Set(ids);
  return withEntries(doc, chapterId, (e) =>
    wanted.has(e.id) && (e.status === "rejected" || (e.status === "applied" && e.kind === "note"))
      ? { ...e, status: "open", resolved_at: null, resolved_by: null, resolution: null }
      : e,
  );
}

/**
 * Ripristina una correzione applicata con una correzione inversa, anch'essa
 * tracciata: il changelog racconta che si è tornati indietro, non lo nasconde.
 */
export function revertRevision(doc: ProjectDoc, chapterId: string, id: string, by: string, at: string, apply: Apply): ProjectDoc {
  const entry = doc.revisions[chapterId]?.entries.find((e) => e.id === id);
  if (!entry) throw new RevisionConflict(`Nessuna voce ${id}`);
  if (entry.status !== "applied") throw new RevisionConflict(`${id} non è applicata`);
  const base = { origin: "manual" as const, panel: entry.panel, balloon: entry.balloon, speaker: null, source_line: entry.source_line };
  let inverse: NewRevision;
  switch (entry.kind) {
    case "text":
    case "action":
    case "set":
      inverse = { ...base, kind: entry.kind, field: entry.field, from: entry.to, to: entry.replaced ?? entry.from };
      break;
    case "add":
      inverse = { ...base, kind: "remove", from: entry.to, to: null };
      break;
    case "remove":
      throw new RevisionConflict("Una battuta tolta non si ripristina da qui: aggiungila di nuovo, o annulla");
    case "note":
      throw new RevisionConflict("Una nota si riapre, non si ripristina");
  }
  const before = new Set(doc.revisions[chapterId]!.entries.map((e) => e.id));
  const added = addRevisions(doc, chapterId, [inverse], by, at, { again: true });
  const ids = [...added.revisions[chapterId]!.entries.filter((e) => !before.has(e.id)).map((e) => e.id), ...openMatching(doc, chapterId, [inverse])];
  return applyRevisions(added, chapterId, ids, by, at, apply);
}

/** La regola per la serie tratta da una voce, o null per toglierla. */
export function setRevisionLesson(doc: ProjectDoc, chapterId: string, id: string, lesson: string | null): ProjectDoc {
  const clean = lesson?.replace(/\s+/g, " ").trim() || null;
  return withEntries(doc, chapterId, (e) => (e.id === id && e.lesson !== clean ? { ...e, lesson: clean } : e));
}

/**
 * Che fine ha fatto una correzione applicata. «Applicata» nel changelog dice
 * cosa si è deciso, non cosa c'è oggi nel documento:
 * - `current`: il documento la contiene ancora;
 * - `superseded`: lì ora c'è altro, perché qualcuno ha rimesso mano;
 * - `lost`: il suo bersaglio non c'è più, o è tornato a una versione più
 *   vecchia — uno spoglio rifatto, un file rimesso da un backup.
 * null per ciò che non lascia un valore da confrontare: note, voci non applicate.
 */
export type RevisionState = "current" | "superseded" | "lost";

export function revisionState(doc: ProjectDoc, entry: RevisionEntry, chapterId?: string): RevisionState | null {
  if (entry.status !== "applied" || entry.kind === "note") return null;
  const panel = entry.panel ? locate(doc, { panel: entry.panel, balloon: null }, chapterId) : null;
  const found = locate(doc, entry, chapterId);
  if (!panel && !found) return "lost";
  if (entry.kind === "remove") return found?.balloon ? "superseded" : "current";
  if (entry.balloon && !found?.balloon) return "superseded";
  if (!found) return "lost";
  if (found.balloon && entry.rev !== null && found.balloon.rev < entry.rev) return "lost";
  const value = entry.kind === "add" ? (found.balloon ? plain(found.balloon) : null) : currentValue(found, entry);
  return same(value, entry.to) ? "current" : "superseded";
}

function withEntries(doc: ProjectDoc, chapterId: string, change: (e: RevisionEntry) => RevisionEntry): ProjectDoc {
  const revs = doc.revisions[chapterId];
  if (!revs) return doc;
  const entries = revs.entries.map(change);
  if (entries.every((e, i) => e === revs.entries[i])) return doc;
  return { ...doc, revisions: { ...doc.revisions, [chapterId]: { ...revs, entries } } };
}
