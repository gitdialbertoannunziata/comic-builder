/**
 * Versionamento dello schema (§5.2, §11.3): ogni file del progetto dichiara
 * `schema`, e all'apertura passa per una catena `migrate` fino alla versione
 * corrente. Una riga oggi; una settimana di lavoro risparmiata fra tre mesi,
 * quando lo schema cambierà e i progetti vecchi dovranno aprirsi lo stesso.
 */
export type DocumentKind = "project" | "scenes" | "chapters" | "page" | "revisions" | "character";

export const CURRENT_SCHEMA = 1;

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[kind][n]` porta un documento dalla versione n+1 alla n+2.
 * Vuoto finché lo schema è alla prima versione: la catena esiste già perché
 * aggiungerla dopo, con progetti in giro, è il caso costoso.
 */
const MIGRATIONS: Record<DocumentKind, Migration[]> = {
  project: [],
  scenes: [],
  chapters: [],
  page: [],
  revisions: [],
  character: [],
};

export class MigrationError extends Error {}

export function migrate(kind: DocumentKind, raw: unknown, path: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MigrationError(`${path}: non è un oggetto JSON`);
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schema;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(`${path}: campo "schema" mancante o non valido`);
  }
  if (version > CURRENT_SCHEMA) {
    // Aprirlo lo stesso significherebbe perdere in silenzio ciò che questa
    // versione non conosce, al primo salvataggio.
    throw new MigrationError(`${path}: schema ${version}, creato da una versione più recente dell'app (questa legge fino a ${CURRENT_SCHEMA})`);
  }
  for (let v = version; v < CURRENT_SCHEMA; v++) {
    const step = MIGRATIONS[kind][v - 1];
    if (!step) throw new MigrationError(`${path}: manca la migrazione ${kind} ${v}→${v + 1}`);
    doc = { ...step(doc), schema: v + 1 };
  }
  return doc;
}
