import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Il changelog delle revisioni di un capitolo (§10.2): `revisions/<id>.json`.
 * Sta fuori dai file di pagina perché un changelog non deve sporcare
 * documenti che devono restare confrontabili (§5.1).
 *
 * Ogni voce è una correzione singola, con chi l'ha chiesta, quando, e che
 * fine ha fatto. È il 赤字 del manga, ma strutturato: si può accettare o
 * rifiutare una per una, e resta la traccia.
 */
export const RevisionKindSchema = z.enum([
  /** Cambia il testo di un balloon. */
  "text",
  /** Cambia la descrizione dell'azione di un pannello (la specifica per chi disegna). */
  "action",
  /** Aggiunge una battuta a un pannello. */
  "add",
  /** Toglie un balloon. */
  "remove",
  /**
   * Una nota: non cambia nulla da sola, è una cosa da fare (camera, layout,
   * arte…). Si chiude come fatta, dicendo cosa si è fatto.
   */
  "note",
  /** Cambia un campo fra quelli di `field`: chi parla, il tipo di battuta, il luogo. */
  "set",
]);
export type RevisionKind = z.infer<typeof RevisionKindSchema>;

export const RevisionStatusSchema = z.enum(["open", "applied", "rejected"]);
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;

/** Da dove viene la correzione: cambia quanto fidarsene e come mostrarla. */
export const RevisionOriginSchema = z.enum(["annotated", "script", "find-replace", "manual"]);

/** I campi che una correzione `set` può cambiare. */
export const RevisionFieldSchema = z.enum(["setting", "continuity_notes", "speaker", "balloon_type"]);
export type RevisionField = z.infer<typeof RevisionFieldSchema>;

export const RevisionEntrySchema = z.object({
  id: IdSchema,
  at: z.string(),
  by: z.string(),
  origin: RevisionOriginSchema,
  kind: RevisionKindSchema,
  panel: IdSchema.nullable(),
  balloon: IdSchema.nullable(),
  /**
   * Bersagli sopra il pannello, per le note: una pagina, una scena. Con tutti
   * e quattro a null la voce riguarda il capitolo intero. L'ambito si deriva
   * da qui (`revisionScope`), non si salva.
   */
  page: IdSchema.nullable().default(null),
  scene: IdSchema.nullable().default(null),
  /** Per `set`: quale campo cambia. `from` e `to` ne sono il valore, come testo. */
  field: RevisionFieldSchema.nullable().default(null),
  /** Per `add`: chi parla. */
  speaker: IdSchema.nullable().default(null),
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** Riga del copione da cui nasce la correzione, se nota (§10.1). */
  source_line: z.number().int().positive().nullable().default(null),
  status: RevisionStatusSchema,
  /** `rev` del balloon dopo l'applicazione: allinea changelog e balloon (§10.2). */
  rev: z.number().int().nonnegative().nullable().default(null),
  resolved_at: z.string().nullable().default(null),
  resolved_by: z.string().nullable().default(null),
  /** Perché è stata rifiutata, o cosa si è fatto per chiudere una nota. */
  resolution: z.string().nullable().default(null),
  /** Il testo davvero sovrascritto, quando si è applicata nonostante il «prima» non corrispondesse più. */
  replaced: z.string().nullable().default(null),
  /**
   * La regola per la serie che l'autore ha tratto da questa voce: arriva allo
   * spoglio di ogni capitolo, perché lo stesso errore non torni.
   */
  lesson: z.string().nullable().default(null),
});
export type RevisionEntry = z.infer<typeof RevisionEntrySchema>;

export const RevisionsDocSchema = z.object({
  schema: z.literal(1),
  chapter_id: IdSchema,
  /**
   * Il copione su cui il capitolo è allineato: file e impronta (§10.1, "ogni
   * versione dello script ha un hash"). Una nuova versione si confronta con
   * questa per sapere quali pannelli tocca.
   */
  script: z.object({ file: z.string(), sha: z.string() }).nullable().default(null),
  entries: z.array(RevisionEntrySchema).default([]),
});
export type RevisionsDoc = z.infer<typeof RevisionsDocSchema>;
