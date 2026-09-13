import { z } from "zod";
import { IdSchema, NormalizedPointSchema } from "./common.js";

/** §8.2: tipi di balloon, incluso `offpanel` per speaker non visibili (telefono, radio, fuori campo). */
export const BalloonTypeSchema = z.enum([
  "speech",
  "thought",
  "whisper",
  "shout",
  "caption",
  "sfx",
  "offpanel",
]);
export type BalloonType = z.infer<typeof BalloonTypeSchema>;

export const EmphasisSchema = z.enum(["bold", "italic", "small"]);
export type Emphasis = z.infer<typeof EmphasisSchema>;

/** Testo come run (§5.6): l'enfasi in un fumetto è semantica, non decorazione. */
export const TextRunSchema = z.object({
  t: z.string(),
  em: EmphasisSchema.optional(),
});
export type TextRun = z.infer<typeof TextRunSchema>;

export const SpeakerSchema = z.object({
  ref: IdSchema.nullable(),
  visible: z.boolean(),
  offscreen_dir: z.enum(["left", "right", "up", "down"]).nullable().optional(),
});
export type Speaker = z.infer<typeof SpeakerSchema>;

export const TailSchema = z.object({
  mode: z.enum(["auto", "manual", "none"]),
  target: NormalizedPointSchema.optional(),
});
export type Tail = z.infer<typeof TailSchema>;

export const SizeModeSchema = z.enum(["fixed", "grow"]);

/** Override di posizionamento per formato (§4.1 regola 3, §5.6): rende onesta la riformattazione. */
export const PerTargetBalloonOverrideSchema = z.object({
  anchor: NormalizedPointSchema.optional(),
  tail: TailSchema.optional(),
  font_scale: z.number().positive().optional(),
});
export type PerTargetBalloonOverride = z.infer<typeof PerTargetBalloonOverrideSchema>;

export const BalloonSchema = z.object({
  id: IdSchema,
  type: BalloonTypeSchema,
  speaker: SpeakerSchema,
  text: z.array(TextRunSchema).min(1),
  anchor: NormalizedPointSchema,
  tail: TailSchema,
  size_mode: SizeModeSchema,
  font_scale: z.number().positive(),
  per_target: z.record(z.string(), PerTargetBalloonOverrideSchema).default({}),
  z: z.number().int(),
  /** Numero di revisione del testo (§5.6, §10.2): dice quando un balloon va riletterato. */
  rev: z.number().int().nonnegative(),
});
export type Balloon = z.infer<typeof BalloonSchema>;
