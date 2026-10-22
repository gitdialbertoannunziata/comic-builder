import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  CharacterSheetSchema,
  ChaptersDocSchema,
  JOURNAL_FILE,
  LocationSheetSchema,
  PROJECT_FILE,
  PageSchema,
  ProjectSchema,
  RevisionsDocSchema,
  ScenesDocSchema,
  acquireLock,
  loadProject,
  releaseLock,
  saveProject,
  type LoadResult,
  type ProjectDoc,
  type SaveResult,
} from "@comic-builder/core";
import type { z } from "zod";
import { NodeProjectStore } from "./nodeStore.js";
import { within } from "./roots.js";

/** Il progetto è aperto altrove (di solito nell'app) e non si scrive. */
export class ProjectBusyError extends Error {}

export interface ProjectInfo {
  path: string;
  id: string;
  title: string;
}

/** Cartelle che non contengono progetti e che non vale la pena attraversare. */
const SKIP = new Set(["node_modules", "dist", "release"]);
const MAX_DEPTH = 3;

/**
 * Lo stato del server: le radici permesse e il progetto "corrente".
 *
 * Il server non tiene il progetto aperto. Ogni lettura lo rilegge dal disco,
 * ogni modifica prende il lock (`.comic-lock`) solo per il tempo di
 * leggere-applicare-salvare e poi lo rilascia. Così l'agente vede sempre ciò
 * che l'utente ha salvato nell'app, e un agente che dimentica di "chiudere"
 * non blocca il progetto all'app. Il rovescio: se il progetto è aperto
 * nell'app, l'app tiene il lock e il server non scrive — è voluto, due
 * scrittori sullo stesso documento si sovrascriverebbero.
 */
export class Workspace {
  readonly session = randomUUID();
  readonly holder = `mcp · ${os.hostname()}`;
  private current: string | null = null;

  constructor(readonly roots: readonly string[]) {
    if (roots.length === 0) throw new Error("No project roots configured: pass --root <dir> or set COMIC_BUILDER_ROOTS.");
  }

  /** I progetti sotto le radici: le cartelle con un `project.json`, senza scendere dentro un progetto. */
  async listProjects(): Promise<ProjectInfo[]> {
    const found: ProjectInfo[] = [];
    const visit = async (dir: string, depth: number): Promise<void> => {
      const info = await this.peek(dir);
      if (info) {
        found.push(info);
        return;
      }
      if (depth >= MAX_DEPTH) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), depth + 1);
      }
    };
    for (const root of this.roots) await visit(root, 0);
    return found;
  }

  private async peek(dir: string): Promise<ProjectInfo | null> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, PROJECT_FILE), "utf8")) as { id?: unknown; title?: unknown };
      return { path: dir, id: String(raw.id ?? ""), title: String(raw.title ?? "") };
    } catch {
      return null;
    }
  }

  /** Un percorso di progetto: assoluto, o relativo a una delle radici. Deve stare dentro una radice. */
  async locate(project?: string): Promise<string> {
    const target = project ?? this.current;
    if (!target) throw new Error("No project selected: call open_project first, or pass `project`.");
    if (path.isAbsolute(target)) return within(target, this.roots);
    for (const root of this.roots) {
      const candidate = path.resolve(root, target);
      if (await this.peek(candidate)) return within(candidate, this.roots);
    }
    return within(path.resolve(this.roots[0]!, target), this.roots);
  }

  store(dir: string): NodeProjectStore {
    return new NodeProjectStore(dir);
  }

  /** Rende corrente un progetto: le chiamate successive senza `project` lavorano su questo. */
  async select(project: string): Promise<{ dir: string; loaded: LoadResult }> {
    const dir = await this.locate(project);
    const loaded = await this.read(dir);
    this.current = dir;
    return { dir, loaded };
  }

  /**
   * Legge il progetto. `loadProject` completa un salvataggio interrotto, cioè
   * scrive: se c'è un journal lo si fa solo col lock in mano, perché il
   * journal potrebbe essere quello di un salvataggio che l'app sta facendo adesso.
   */
  async read(dir: string): Promise<LoadResult> {
    const store = this.store(dir);
    if ((await store.readText(JOURNAL_FILE)) === null) return loadProject(store);
    return this.withLock(store, () => loadProject(store));
  }

  /**
   * Modifica il progetto: lock → lettura fresca → `change` → controllo degli
   * schemi → salvataggio incrementale → rilascio. `change` non scrive niente:
   * restituisce il documento nuovo, e se lancia non si salva nulla.
   */
  async mutate<T>(dir: string, change: (doc: ProjectDoc) => { next: ProjectDoc; result: T }): Promise<{ result: T; saved: SaveResult }> {
    const store = this.store(dir);
    return this.withLock(store, async () => {
      const { doc } = await loadProject(store);
      const { next, result } = change(doc);
      assertSchemas(next, doc);
      const saved = await saveProject(store, next, doc);
      return { result, saved };
    });
  }

  /** Scrittura di file che non sono documenti (export), col lock come ogni altra scrittura. */
  async withProjectLock<T>(dir: string, work: (store: NodeProjectStore) => Promise<T>): Promise<T> {
    const store = this.store(dir);
    return this.withLock(store, () => work(store));
  }

  private async withLock<T>(store: NodeProjectStore, work: () => Promise<T>): Promise<T> {
    const lock = await acquireLock(store, this.session, this.holder, new Date());
    if (!lock.acquired) {
      throw new ProjectBusyError(
        `The project is open elsewhere (${lock.held.holder}, since ${lock.held.at}): close it there, or wait for the lock to expire, before writing.`,
      );
    }
    try {
      return await work();
    } finally {
      await releaseLock(store, this.session);
    }
  }
}

/**
 * I comandi dell'editor tengono valida la struttura, ma un agente può
 * mandare campi liberi che il tipo TypeScript avrebbe fermato a compile
 * time. Prima di salvare, ogni file cambiato ripassa dal suo schema: un
 * documento che poi `loadProject` rifiuterebbe non arriva mai su disco.
 */
function assertSchemas(next: ProjectDoc, previous: ProjectDoc): void {
  const check = (schema: z.ZodTypeAny, value: unknown, where: string) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return;
    const first = parsed.error.issues[0];
    throw new Error(`${where}: ${first ? `${first.path.join(".")}: ${first.message}` : "does not match the schema"}`);
  };
  const changed = <V>(a: Readonly<Record<string, V>>, b: Readonly<Record<string, V>>) => Object.entries(a).filter(([key, value]) => b[key] !== value);

  if (next.project !== previous.project) check(ProjectSchema, next.project, PROJECT_FILE);
  if (next.scenes !== previous.scenes) check(ScenesDocSchema, next.scenes, next.project.scenes);
  if (next.chapters !== previous.chapters) check(ChaptersDocSchema, next.chapters, next.project.chapters);
  for (const [id, page] of changed(next.pages, previous.pages)) check(PageSchema, page, `page ${id}`);
  for (const [id, doc] of changed(next.revisions, previous.revisions)) check(RevisionsDocSchema, doc, `revisions ${id}`);
  for (const [ref, sheet] of changed(next.characters, previous.characters)) check(CharacterSheetSchema, sheet, `character ${ref}`);
  for (const [ref, sheet] of changed(next.locations, previous.locations)) check(LocationSheetSchema, sheet, `location ${ref}`);
}
