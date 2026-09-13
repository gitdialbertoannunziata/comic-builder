import { z } from "zod";

/**
 * Vocabolario chiuso della camera (§6.1). Enum chiusi, non stringa libera:
 * è il contratto che il compilatore mappa in prompt e che il lint verifica.
 */
export const ShotSchema = z.enum([
  "EWS",
  "LS",
  "MLS",
  "MS",
  "MCU",
  "CU",
  "ECU",
  "INSERT",
]);
export type Shot = z.infer<typeof ShotSchema>;

export const AngleSchema = z.enum([
  "eye",
  "low",
  "high",
  "birds",
  "worms",
  "dutch",
  "ots",
  "pov",
]);
export type Angle = z.infer<typeof AngleSchema>;

export const LensMmSchema = z.union([
  z.literal(24),
  z.literal(35),
  z.literal(50),
  z.literal(85),
  z.literal(135),
]);
export type LensMm = z.infer<typeof LensMmSchema>;

export const DofSchema = z.enum(["shallow", "deep", "split"]);
export type Dof = z.infer<typeof DofSchema>;

export const LightingSchema = z.enum([
  "flat",
  "backlit",
  "rim",
  "hard",
  "soft",
  "practical",
  "night",
  "golden",
]);
export type Lighting = z.infer<typeof LightingSchema>;

/** Non entra mai nel prompt (§6.1): governa palette, postura, composizione. */
export const MoodSchema = z.enum([
  "calm",
  "tense",
  "dread",
  "warm",
  "grief",
  "action",
  "wonder",
  "ironic",
]);
export type Mood = z.infer<typeof MoodSchema>;

export const MotionSchema = z.enum(["static", "implied", "pan", "dolly", "zoom"]);
export type Motion = z.infer<typeof MotionSchema>;

export const SubjectPlacementSchema = z.enum([
  "left-third",
  "center",
  "right-third",
  "two-shot",
  "none",
]);
export type SubjectPlacement = z.infer<typeof SubjectPlacementSchema>;

/** Non entra mai nel prompt (§6.1): metadato per il lint di continuità (regola dei 180°). */
export const AxisSideSchema = z.enum(["A-left", "A-right"]);
export type AxisSide = z.infer<typeof AxisSideSchema>;

export const CameraSchema = z.object({
  shot: ShotSchema,
  angle: AngleSchema,
  lens_mm: LensMmSchema,
  dof: DofSchema,
  lighting: LightingSchema,
  mood: MoodSchema,
  motion: MotionSchema,
  subject_placement: SubjectPlacementSchema,
  axis_side: AxisSideSchema,
});
export type Camera = z.infer<typeof CameraSchema>;
