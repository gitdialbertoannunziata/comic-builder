import { z } from "zod";
import { IdSchema } from "./common.js";

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
});
export type Beat = z.infer<typeof BeatSchema>;

export const SceneSchema = z.object({
  id: IdSchema,
  title: z.string(),
  location: z.string(),
  time_of_day: z.string(),
  characters: z.array(IdSchema).default([]),
  style_ref: z.string().nullable().default(null),
  beats: z.array(BeatSchema).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScenesDocSchema = z.object({
  schema: z.literal(1),
  scenes: z.array(SceneSchema),
});
export type ScenesDoc = z.infer<typeof ScenesDocSchema>;
