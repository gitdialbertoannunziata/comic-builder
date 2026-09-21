import { ProjectSchema, type Project } from "../schema/project.js";
import { ScenesDocSchema, type ScenesDoc } from "../schema/scenes.js";
import { ChaptersDocSchema, type ChaptersDoc } from "../schema/chapters.js";
import { PageSchema, type Page } from "../schema/page.js";
import { issue, type ValidationIssue } from "../validate/issue.js";
import { migrate, MigrationError, type DocumentKind } from "./migrate.js";
import type { ProjectStore } from "./store.js";
import type { z } from "zod";

/**
 * Il progetto in memoria: gli stessi file della cartella (§5.1), già
 * validati. È **immutabile**: ogni modifica produce un nuovo `ProjectDoc` che
 * condivide con il precedente tutto ciò che non è cambiato. Da questo
 * discendono sia l'undo (uno stato precedente è un riferimento) sia il
 * salvataggio incrementale (si scrive solo ciò il cui riferimento è cambiato).
 */
export interface ProjectDoc {
  project: Project;
  scenes: ScenesDoc;
  chapters: ChaptersDoc;
  /** Pagine per id. L'ordine sta in `chapters` (§5.3), non qui. */
  pages: Readonly<Record<string, Page>>;
}

export const PROJECT_FILE = "project.json";
export const JOURNAL_FILE = ".comic-journal.json";

export function pagePath(pageId: string): string {
  return `pages/${pageId}.json`;
}

/** Serializzazione stabile: stesso documento, stessi byte — il presupposto di un diff leggibile (§5.1). */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class ProjectLoadError extends Error {}

async function readDocument<S extends z.ZodTypeAny>(
  store: ProjectStore,
  path: string,
  kind: DocumentKind,
  schema: S,
): Promise<z.infer<S> | null> {
  const text = await store.readText(path);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ProjectLoadError(`${path}: JSON non valido (${error instanceof Error ? error.message : String(error)})`);
  }
  try {
    const migrated = migrate(kind, raw, path);
    const parsed = schema.safeParse(migrated);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ProjectLoadError(`${path}: ${first ? `${first.path.join(".")}: ${first.message}` : "non conforme allo schema"}`);
    }
    return parsed.data as z.infer<S>;
  } catch (error) {
    if (error instanceof MigrationError) throw new ProjectLoadError(error.message);
    throw error;
  }
}

export interface LoadResult {
  doc: ProjectDoc;
  issues: ValidationIssue[];
  /** Vero se all'apertura c'era un salvataggio interrotto, e lo si è completato. */
  recovered: boolean;
}

/**
 * Apre un progetto. Gli errori di struttura (file principale mancante, JSON
 * rotto, schema non valido) fermano l'apertura: aprire a metà e poi salvare
 * cancellerebbe ciò che non si è riusciti a leggere. Le incoerenze di
 * contenuto (una pagina elencata che manca, un file orfano) diventano
 * avvisi: il progetto si apre e lo si può riparare.
 */
export async function loadProject(store: ProjectStore): Promise<LoadResult> {
  const recovered = await recoverJournal(store);

  const project = await readDocument(store, PROJECT_FILE, "project", ProjectSchema);
  if (!project) throw new ProjectLoadError(`Nella cartella "${store.label}" non c'è ${PROJECT_FILE}: non è un progetto.`);

  const scenes = (await readDocument(store, project.scenes, "scenes", ScenesDocSchema)) ?? { schema: 1 as const, scenes: [] };
  const chapters = (await readDocument(store, project.chapters, "chapters", ChaptersDocSchema)) ?? { schema: 1 as const, chapters: [] };

  const issues: ValidationIssue[] = [];
  if (recovered) {
    issues.push(issue("info", "project.recovered", "Un salvataggio era stato interrotto: completato all'apertura", JOURNAL_FILE));
  }

  const pages: Record<string, Page> = {};
  for (const chapter of chapters.chapters) {
    for (const pageId of chapter.pages) {
      const page = await readDocument(store, pagePath(pageId), "page", PageSchema);
      if (!page) {
        issues.push(issue("error", "project.missing-page", `Il capitolo ${chapter.id} elenca la pagina ${pageId}, ma il file manca`, pagePath(pageId)));
        continue;
      }
      if (page.id !== pageId) {
        issues.push(issue("error", "project.page-id-mismatch", `${pagePath(pageId)} contiene la pagina ${page.id}`, pagePath(pageId)));
      }
      if (page.chapter_id !== chapter.id) {
        issues.push(issue("warning", "project.page-chapter-mismatch", `La pagina ${pageId} dichiara il capitolo ${page.chapter_id}, ma è elencata in ${chapter.id}`, pagePath(pageId)));
      }
      pages[pageId] = page;
    }
  }

  // Un file in pages/ che nessun capitolo elenca non si perde: si segnala.
  for (const entry of await store.list("pages")) {
    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -".json".length);
    if (!pages[id]) {
      issues.push(issue("warning", "project.orphan-page", `pages/${entry.name} non è elencata in nessun capitolo`, `pages/${entry.name}`));
    }
  }

  return { doc: { project, scenes, chapters, pages }, issues, recovered };
}

interface Journal {
  at: string;
  writes: Array<{ path: string; text: string }>;
  removes: string[];
}

/**
 * Forma canonica di un documento prima della scrittura: passato dallo schema,
 * ha le chiavi nell'ordine dello schema e i default espliciti. Senza, una
 * pagina costruita in memoria e la stessa pagina riletta dal file
 * differiscono nell'ordine delle chiavi, e il primo salvataggio dopo
 * l'apertura produrrebbe un diff senza nessuna modifica. Ed è l'ultimo
 * cancello: un documento non valido non arriva su disco.
 */
function canonical<S extends z.ZodTypeAny>(schema: S, value: unknown, path: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Salvataggio rifiutato, ${path} non è valido: ${first ? `${first.path.join(".")}: ${first.message}` : "schema"}`);
  }
  return serialize(parsed.data);
}

/** Ciò che cambia fra due stati del documento, per riferimento: le "patch" del salvataggio. */
export function changedFiles(next: ProjectDoc, previous: ProjectDoc | null): Journal {
  const writes: Journal["writes"] = [];
  const removes: string[] = [];
  if (!previous || next.project !== previous.project) writes.push({ path: PROJECT_FILE, text: canonical(ProjectSchema, next.project, PROJECT_FILE) });
  if (!previous || next.scenes !== previous.scenes) writes.push({ path: next.project.scenes, text: canonical(ScenesDocSchema, next.scenes, next.project.scenes) });
  if (!previous || next.chapters !== previous.chapters) writes.push({ path: next.project.chapters, text: canonical(ChaptersDocSchema, next.chapters, next.project.chapters) });
  for (const [id, page] of Object.entries(next.pages)) {
    if (!previous || previous.pages[id] !== page) writes.push({ path: pagePath(id), text: canonical(PageSchema, page, pagePath(id)) });
  }
  if (previous) {
    for (const id of Object.keys(previous.pages)) if (!next.pages[id]) removes.push(pagePath(id));
  }
  return { at: "", writes, removes };
}

export interface SaveResult {
  written: string[];
  removed: string[];
}

/**
 * Salva ciò che è cambiato rispetto a `previous` (null: tutto).
 *
 * Un file solo si scrive e basta: la scrittura dello store è atomica. Più
 * file no — un crash fra il secondo e il terzo lascerebbe un progetto
 * incoerente (la pagina nuova scritta, il capitolo che la elenca no). Per
 * quelli si scrive prima un journal con tutto il contenuto, poi i file, poi
 * si cancella il journal. All'apertura un journal presente si riapplica:
 * il salvataggio o è avvenuto tutto, o si completa (§11.3).
 */
export async function saveProject(store: ProjectStore, next: ProjectDoc, previous: ProjectDoc | null, now = new Date()): Promise<SaveResult> {
  const plan = changedFiles(next, previous);
  const touched = plan.writes.length + plan.removes.length;
  if (touched === 0) return { written: [], removed: [] };

  if (touched > 1) {
    await store.writeText(JOURNAL_FILE, serialize({ ...plan, at: now.toISOString() }));
  }
  await applyJournal(store, plan);
  if (touched > 1) await store.remove(JOURNAL_FILE);

  return { written: plan.writes.map((w) => w.path), removed: plan.removes };
}

async function applyJournal(store: ProjectStore, journal: Journal): Promise<void> {
  for (const { path, text } of journal.writes) await store.writeText(path, text);
  for (const path of journal.removes) await store.remove(path);
}

/** Completa un salvataggio interrotto, se c'è. Idempotente: riscrivere lo stesso contenuto non cambia nulla. */
export async function recoverJournal(store: ProjectStore): Promise<boolean> {
  const text = await store.readText(JOURNAL_FILE);
  if (text === null) return false;
  let journal: Journal;
  try {
    journal = JSON.parse(text) as Journal;
  } catch {
    // Un journal illeggibile vuol dire che il crash è avvenuto *mentre si
    // scriveva il journal*, quindi prima di toccare qualunque file: il
    // progetto è ancora quello di prima, e il journal si butta.
    await store.remove(JOURNAL_FILE);
    return false;
  }
  await applyJournal(store, journal);
  await store.remove(JOURNAL_FILE);
  return true;
}

/** Un progetto nuovo a partire da un capitolo già impaginato (per esempio l'uscita dello spoglio). */
export function projectDocFrom(input: {
  project: Project;
  scenes: ScenesDoc["scenes"];
  chapter: { id: string; number: number; title: string };
  pages: readonly Page[];
}): ProjectDoc {
  const ordered = [...input.pages].sort((a, b) => a.order - b.order);
  return {
    project: input.project,
    scenes: { schema: 1, scenes: [...input.scenes] },
    chapters: {
      schema: 1,
      chapters: [{ ...input.chapter, status: "in-production", pages: ordered.map((p) => p.id) }],
    },
    pages: Object.fromEntries(ordered.map((p) => [p.id, p])),
  };
}
