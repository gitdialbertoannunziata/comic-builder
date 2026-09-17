/**
 * Vocabolario chiuso della camera (§6.1), riportato qui come liste per i menù
 * a tendina del form. Stesso elenco degli enum Zod in @comic-builder/core —
 * copiato invece che introspezionato a runtime per restare indipendente dai
 * dettagli interni di zod (union di literal per `lens_mm` vs enum per gli altri).
 */
export const SHOT_OPTIONS = ["EWS", "LS", "MLS", "MS", "MCU", "CU", "ECU", "INSERT"] as const;
export const ANGLE_OPTIONS = ["eye", "low", "high", "birds", "worms", "dutch", "ots", "pov"] as const;
export const LENS_MM_OPTIONS = [24, 35, 50, 85, 135] as const;
export const DOF_OPTIONS = ["shallow", "deep", "split"] as const;
export const LIGHTING_OPTIONS = [
  "flat",
  "backlit",
  "rim",
  "hard",
  "soft",
  "practical",
  "night",
  "golden",
] as const;
export const MOOD_OPTIONS = ["calm", "tense", "dread", "warm", "grief", "action", "wonder", "ironic"] as const;
export const MOTION_OPTIONS = ["static", "implied", "pan", "dolly", "zoom"] as const;
export const SUBJECT_PLACEMENT_OPTIONS = [
  "left-third",
  "center",
  "right-third",
  "two-shot",
  "none",
] as const;
export const AXIS_SIDE_OPTIONS = ["A-left", "A-right"] as const;

export const ANGLE_LABELS: Record<(typeof ANGLE_OPTIONS)[number], string> = {
  eye: "inquadratura ad altezza occhi",
  low: "dal basso",
  high: "dall'alto",
  birds: "a picco",
  worms: "supina",
  dutch: "olandese",
  ots: "over-the-shoulder",
  pov: "soggettiva",
};

export const SHOT_LABELS: Record<(typeof SHOT_OPTIONS)[number], string> = {
  EWS: "campo lunghissimo",
  LS: "campo lungo",
  MLS: "campo medio",
  MS: "piano americano",
  MCU: "mezzoprimo piano",
  CU: "primo piano",
  ECU: "primissimo piano",
  INSERT: "dettaglio",
};
