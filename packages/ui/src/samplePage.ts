import { buildPagesFromScene, type Page } from "@comic-builder/core";
import { sampleScene } from "@comic-builder/core/fixtures";
import { TARGET } from "./renderPreview.js";

/**
 * Documento di partenza dell'Ispettore: le pagine che lo spoglio produce dalla
 * scena di esempio, passando per la stessa catena di F1 (beat → camera dalla
 * tabella di §6.2, template dal catalogo, id stabili). Non un documento
 * scritto a mano per la demo: quello che il prodotto genera davvero.
 */
export const initialPages: Page[] = buildPagesFromScene({
  chapterId: "ep001",
  scene: sampleScene,
  firstPageNumber: 1,
  primaryTarget: TARGET,
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});

export const initialScene = sampleScene;
