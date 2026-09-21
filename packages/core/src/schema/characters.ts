import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Scheda personaggio (§5.1: `characters/<ref>.json`).
 *
 * Il documento conosce i personaggi per ref (`sara`), ruolo ed espressione
 * nel singolo pannello: abbastanza per il lettering e per il lint, non per
 * disegnarli. La scheda dice com'è fatto il personaggio, una volta per
 * tutta la serie — ed è ciò che rende coerente fra un pannello e l'altro
 * chi lo disegna, persona o modello.
 *
 * Aspetto in campi separati invece che un testo unico: il compilatore li
 * ricompone in forma breve per il prompt e in chiaro per il brief, e la UI
 * può dire cosa manca.
 */
export const AppearanceSchema = z.object({
  age: z.string().default(""),
  build: z.string().default(""),
  face: z.string().default(""),
  hair: z.string().default(""),
  eyes: z.string().default(""),
  skin: z.string().default(""),
  /** Segni particolari: cicatrici, occhiali, un tatuaggio. Ciò che lo fa riconoscere al primo sguardo. */
  distinguishing: z.string().default(""),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const CharacterReferenceSchema = z.object({
  /** Percorso nel progetto, es. `characters/sara/fronte.png`. */
  path: z.string(),
  note: z.string().default(""),
});

export const CharacterSheetSchema = z.object({
  schema: z.literal(1),
  /** Il ref usato nei pannelli e nei balloon (§5.3). */
  id: IdSchema,
  /** Come si chiama nella storia, per le persone: «Sara Bellini». */
  name: z.string().default(""),
  /** Una riga: chi è. Serve a chi legge la scheda, non entra nel prompt. */
  summary: z.string().default(""),
  appearance: AppearanceSchema.default({}),
  /**
   * Costumi per nome (`default`, `notte`, `divisa`): il pannello sceglie con
   * `characters[].wardrobe`. Una storia che cambia d'abito a metà capitolo
   * lo dichiara qui, invece di lasciarlo all'interpretazione.
   */
  wardrobe: z.record(z.string(), z.string()).default({}),
  /** Colori ricorrenti del personaggio: per chi colora, e per il modello. */
  palette: z.string().default(""),
  references: z.array(CharacterReferenceSchema).default([]),
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;
