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

export const ArtSchema = z.object({
  source: z.string().nullable(),
  status: ArtStatusSchema,
  /** sha del file d'arte al momento della composizione (§9.2): equivalente della staleness nel ramo manuale. */
  sha: z.string().nullable().optional(),
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
});
export type Panel = z.infer<typeof PanelSchema>;
