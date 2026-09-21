import type { Camera } from "../schema/camera.js";
import type { PanelCharacter } from "../schema/panel.js";

/**
 * Frammenti del compilatore (§6.1): da ogni valore chiuso della camera a una
 * frase per il modello di immagini. È la colonna "frammento per il
 * compilatore" della tabella del piano, qui come dato.
 *
 * In inglese di proposito: è la lingua in cui i modelli di immagini sono
 * stati addestrati sulle didascalie, e la terminologia di ripresa lì è
 * inglese anche nei set di dati italiani. Il contenuto dell'autore (azione,
 * luogo) resta nella sua lingua: i modelli recenti lo capiscono, e
 * tradurlo sarebbe un altro punto in cui introdurre errori.
 */
export const SHOT_FRAGMENT: Record<Camera["shot"], string> = {
  EWS: "extreme wide shot, tiny subject in vast space",
  LS: "wide shot, full figure in environment",
  MLS: "medium long shot, knees up",
  MS: "medium shot, waist up",
  MCU: "medium close-up, chest up",
  CU: "close-up, face fills frame",
  ECU: "extreme close-up, eyes",
  INSERT: "insert shot of object",
};

export const ANGLE_FRAGMENT: Record<Camera["angle"], string> = {
  eye: "eye level",
  low: "low angle looking up, imposing",
  high: "high angle looking down, vulnerable",
  birds: "birds-eye view, top down",
  worms: "worms-eye view, ground level",
  dutch: "dutch angle, tilted horizon, unease",
  ots: "over-the-shoulder framing",
  pov: "first-person POV",
};

export const LENS_FRAGMENT: Record<Camera["lens_mm"], string> = {
  24: "24mm wide lens, exaggerated perspective",
  35: "35mm lens",
  50: "50mm lens, natural perspective",
  85: "85mm lens, compressed perspective",
  135: "135mm telephoto, flattened perspective",
};

export const DOF_FRAGMENT: Record<Camera["dof"], string | null> = {
  shallow: "shallow depth of field, blurred background",
  deep: null,
  split: "split diopter, foreground and background both in focus",
};

export const LIGHTING_FRAGMENT: Record<Camera["lighting"], string> = {
  flat: "even flat lighting",
  backlit: "backlit, rim light",
  rim: "rim light",
  hard: "hard shadows, high contrast",
  soft: "soft diffused light",
  practical: "practical light sources in scene",
  night: "night, low key lighting",
  golden: "golden hour light",
};

/** Solo `implied` entra nel prompt: gli altri descrivono un movimento di macchina, che un'immagine ferma non ha (§6.1). */
export const MOTION_FRAGMENT: Record<Camera["motion"], string | null> = {
  static: null,
  implied: "motion blur, speed lines",
  pan: null,
  dolly: null,
  zoom: null,
};

export const PLACEMENT_FRAGMENT: Record<Camera["subject_placement"], string | null> = {
  "left-third": "subject on left third",
  center: "subject centered",
  "right-third": "subject on right third",
  "two-shot": "two-shot, both characters in frame",
  none: null,
};

export const FRAMING_FRAGMENT: Record<PanelCharacter["framing"], string> = {
  "full-body": "full body",
  "head-and-torso": "head and torso",
  "head-only": "head only",
  "hands-only": "hands only",
  silhouette: "silhouette",
};

/**
 * Il tono non entra nel prompt (§6.1: agisce su palette, postura e
 * composizione, non è un frammento). Entra invece nel brief, come
 * indicazione esplicita per un modello che segue istruzioni.
 */
export const MOOD_GUIDANCE: Record<Camera["mood"], string> = {
  calm: "calm: balanced composition, open space, gentle palette",
  tense: "tense: tight framing, strong diagonals, restrained palette",
  dread: "dread: heavy negative space, deep shadows, desaturated palette",
  warm: "warm: soft shapes, close distances, warm palette",
  grief: "grief: isolated figure, downward lines, muted cold palette",
  action: "action: dynamic diagonals, foreshortening, high contrast",
  wonder: "wonder: small figure against scale, light from above, luminous palette",
  ironic: "ironic: deadpan framing, symmetrical composition",
};

/** Negativo di base, oltre allo stile del progetto: il lettering è nostro (§8), il modello non deve scrivere. */
export const BASE_NEGATIVE = ["text", "lettering", "speech balloons", "captions", "watermark", "signature", "panel borders"];
