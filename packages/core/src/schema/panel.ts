import { z } from "zod";
import { IdSchema, SourceRefSchema } from "./common.js";
import { CameraSchema } from "./camera.js";
import { BalloonSchema } from "./balloon.js";

/**
 * Posizione nella griglia a tracce (§7.1): l'area deve tassellare, verificato da validateDocument.
 * `z` di default 0; un valore diverso da 0 dichiara esplicitamente un inset che può sovrapporsi
 * ad altre aree (§7.1: "gli inset dichiarano z esplicito").
 */
export const AreaSchema = z.object({
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  col_span: z.number().int().positive().default(1),
  row_span: z.number().int().positive().default(1),
  z: z.number().int().default(0),
});
export type Area = z.infer<typeof AreaSchema>;

export const BorderSchema = z.object({
  style: z.enum(["solid", "dashed", "none"]),
  width: z.number().nonnegative(),
  radius: z.number().nonnegative().default(0),
});
export type Border = z.infer<typeof BorderSchema>;

export const CharacterFramingSchema = z.enum([
  "full-body",
  "head-and-torso",
  "head-only",
  "hands-only",
  "silhouette",
]);

export const PanelCharacterSchema = z.object({
  ref: IdSchema,
  weight: z.number().min(0).max(1),
  role: z.enum(["lead", "support", "background"]),
  framing: CharacterFramingSchema,
  expression: z.string(),
  wardrobe: z.string().default("default"),
});
export type PanelCharacter = z.infer<typeof PanelCharacterSchema>;

export const ArtStatusSchema = z.enum(["missing", "sketch", "inked", "colored", "final"]);

/**
 * Come l'arte sta nel pannello (§7.4: `crop_anchor`). Il pannello è una
 * finestra; qui si dice quanto è grande il disegno dietro e quale punto ne
 * sta al centro. Senza, un disegno di proporzioni diverse dal pannello
 * perde sempre lo stesso pezzo — di solito le teste.
 */
export const ArtFrameSchema = z.object({
  /** `cover`: riempie il pannello (e taglia); `contain`: si vede intero (e lascia margini). */
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Moltiplicatore sopra l'adattamento: 1 = esattamente cover o contain. */
  zoom: z.number().min(0.1).max(10).default(1),
  /** Punto dell'immagine (normalizzato) che sta al centro del pannello. */
  focus_x: z.number().min(0).max(1).default(0.5),
  focus_y: z.number().min(0).max(1).default(0.5),
});
export type ArtFrame = z.infer<typeof ArtFrameSchema>;

export const ArtSchema = z.object({
  source: z.string().nullable(),
  status: ArtStatusSchema,
  /** sha del file d'arte al momento della composizione (§9.2): equivalente della staleness nel ramo manuale. */
  sha: z.string().nullable().optional(),
  /** Dimensioni in pixel dell'immagine: servono all'inquadratura. Registrate al collegamento. */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).nullable().optional(),
  frame: ArtFrameSchema.optional(),
});
export type Art = z.infer<typeof ArtSchema>;

export const PromptOverrideSchema = z.object({
  override: z.string().nullable(),
  negative_override: z.string().nullable(),
});

export const SeedSchema = z.object({
  mode: z.enum(["auto", "override"]),
  value: z.number().int().nullable(),
  epoch: z.number().int().nonnegative(),
});
export type Seed = z.infer<typeof SeedSchema>;

export const RenderRecordSchema = z.object({
  spec_hash: z.string(),
  file: z.string(),
  engine: z.string(),
  rendered_at: z.string(),
});

/**
 * Fascia orizzontale del pannello che lo slicing non deve tagliare (§7.2),
 * in coordinate normalizzate all'altezza del pannello. I balloon sono
 * geometria nota e si evitano da soli; i volti no, e in v1 li indica l'autore.
 */
export const SliceBandSchema = z
  .object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) })
  .refine((b) => b.to > b.from, { message: "La banda deve avere to > from" });
export type SliceBand = z.infer<typeof SliceBandSchema>;

export const PanelSchema = z.object({
  id: IdSchema,
  scene_id: IdSchema,
  beat_index: z.number().int().nonnegative(),
  source: SourceRefSchema.nullable().optional(),
  area: AreaSchema,
  border: BorderSchema,
  camera: CameraSchema,
  action: z.string(),
  setting: z.string(),
  props: z.array(z.string()).default([]),
  continuity_notes: z.string().default(""),
  characters: z.array(PanelCharacterSchema).default([]),
  art: ArtSchema,
  prompt: PromptOverrideSchema.default({ override: null, negative_override: null }),
  control_image: z.string().nullable().default(null),
  seed: SeedSchema,
  render: z.record(z.string(), RenderRecordSchema.nullable()).default({}),
  balloons: z.array(BalloonSchema).default([]),
  slice_avoid: z.array(SliceBandSchema).default([]),
  /**
   * Indice più alto mai assegnato a un balloon del pannello. Gli id non si riusano (§5.3):
   * senza questo contatore, cancellare l'ultimo balloon e crearne uno nuovo ne
   * riprodurrebbe l'id, e una voce di changelog scritta per il vecchio
   * finirebbe sul nuovo (§10.2). Assente nei documenti vecchi: vale il massimo presente.
   */
  balloon_seq: z.number().int().nonnegative().optional(),
});
export type Panel = z.infer<typeof PanelSchema>;
