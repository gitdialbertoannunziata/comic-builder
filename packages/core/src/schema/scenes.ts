import { z } from "zod";
import { IdSchema, SourceRefSchema } from "./common.js";
import { BalloonTypeSchema } from "./balloon.js";
import { MoodSchema, LightingSchema } from "./camera.js";

/**
 * Funzione narrativa del beat (§5.3, §6.2): input della tabella beat→camera,
 * non un'etichetta decorativa.
 */
export const BeatFunctionSchema = z.enum([
  "establish",
  "entrance",
  "dialogue",
  "reaction",
  "reveal",
  "action",
  "close",
]);
export type BeatFunction = z.infer<typeof BeatFunctionSchema>;

export const BeatSchema = z.object({
  id: IdSchema,
  function: BeatFunctionSchema,
  summary: z.string(),
  /**
   * Beat "intenso": seleziona la colonna variante della tabella beat→camera
   * (§6.2). È l'unico grado di libertà che lo spoglio ha sull'inquadratura —
   * tutto il resto è derivato, quindi verificabile.
   */
  intense: z.boolean().default(false),
  /** Provenienza nello script (§10.1): da qui arriva al pannello che il beat genera. */
  source: SourceRefSchema.nullable().default(null),
  /**
   * Battute del beat, se ne ha. Lo spoglio le estrae dallo script e il
   * costruttore della pagina le trasforma in balloon: senza, un beat
   * `dialogue` produrrebbe un pannello di dialogo senza dialogo.
   * `speaker` è un ref di personaggio, oppure null per didascalie e voce fuori campo.
   */
  lines: z
    .array(
      z.object({
        speaker: IdSchema.nullable(),
        text: z.string(),
        type: BalloonTypeSchema.default("speech"),
      }),
    )
    .default([]),
  /**
   * Chi è davvero in vignetta, con l'espressione se lo spoglio la deduce.
   * `null` significa "non specificato": solo allora il pannello eredita tutto
   * il cast della scena. Senza questo campo ogni pannello riceveva tutti i
   * personaggi, e il campo lungo di un luogo vuoto chiedeva di disegnarci due
   * persone.
   */
  characters: z
    .array(
      z.object({
        ref: IdSchema,
        expression: z.string().default(""),
        /** Costume della scheda personaggio (§5.1) per questo beat; `default` se è quello di sempre. */
        wardrobe: z.string().default("default"),
      }),
    )
    .nullable()
    .default(null),
  /**
   * Tono del singolo beat, quando si discosta da quello della scena: il tono
   * cambia dentro una scena, spesso proprio nel beat che conta.
   */
  mood: MoodSchema.nullable().default(null),
  /** Oggetti da disegnare (§5.5: parte della specifica di disegno). */
  props: z.array(z.string()).default([]),
});
export type Beat = z.infer<typeof BeatSchema>;

export const SceneSchema = z.object({
  id: IdSchema,
  title: z.string(),
  location: z.string(),
  time_of_day: z.string(),
  characters: z.array(IdSchema).default([]),
  /**
   * Tono e luce della scena, nel vocabolario chiuso di §6.1. Arrivano alla
   * camera di ogni pannello: prima non c'erano, e ogni vignetta usciva con
   * `lighting: flat` anche in una scena all'alba.
   */
  mood: MoodSchema.nullable().default(null),
  lighting: LightingSchema.nullable().default(null),
  style_ref: z.string().nullable().default(null),
  beats: z.array(BeatSchema).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScenesDocSchema = z.object({
  schema: z.literal(1),
  scenes: z.array(SceneSchema),
});
export type ScenesDoc = z.infer<typeof ScenesDocSchema>;
