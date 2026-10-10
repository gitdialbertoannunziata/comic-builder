import type { Camera } from "@comic-builder/core";
import { t } from "./i18n.js";

/**
 * Nomi leggibili dei formati. Gli id restano quelli del progetto (e si
 * leggono nei `title`): un formato che qui non c'è si mostra col suo id.
 */
const TARGET_LABELS: Record<string, string> = {
  "digital-page": "Digitale",
  "print-b5": "Stampa B5",
  "webtoon-strip": "Striscia",
  "guided-view": "Guided view",
};

export function targetLabel(id: string): string {
  return t(TARGET_LABELS[id] ?? id);
}

/** Etichette dei campi della camera (§6.1). I valori restano il vocabolario chiuso. */
export const CAMERA_FIELD_LABELS: Record<keyof Camera, string> = {
  shot: "inquadratura",
  angle: "angolo",
  lens_mm: "focale (mm)",
  dof: "profondità di campo",
  lighting: "luce",
  mood: "tono",
  motion: "movimento",
  subject_placement: "soggetto",
  axis_side: "asse di scena",
};
