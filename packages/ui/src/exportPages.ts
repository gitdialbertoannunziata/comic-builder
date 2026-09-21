import { pageFileNames, type ExportFile, type Page, type Scene } from "@comic-builder/core";
import type { LoadedFont } from "@comic-builder/lettering";
import { renderPreview, PAGE_WIDTH_PX, PAGE_HEIGHT_PX, LETTERING } from "./renderPreview.js";
import { embedFont, svgToPngBlob } from "./platform/rasterize.js";

export type ExportFormat = "png" | "svg" | "json";

export interface ExportInput {
  pages: readonly Page[];
  scene: Scene;
  font: LoadedFont;
  fontBytes: Uint8Array;
  format: ExportFormat;
  /** Larghezza del PNG in pixel; l'altezza segue il rapporto della pagina. */
  widthPx: number;
  /** Solo la pagina corrente, oppure tutte quelle del capitolo. */
  only?: Page;
  /**
   * Nell'export finale il layer bozza si spegne: un pannello non disegnato
   * dev'essere un pannello vuoto, non un foglio di spoglio consegnato per
   * errore al posto della tavola.
   */
  draft: boolean;
}

export async function buildExportFiles(input: ExportInput): Promise<ExportFile[]> {
  const pages = input.only ? [input.only] : [...input.pages];
  // I nomi si calcolano sull'intero capitolo anche quando se ne esporta una
  // sola: così il prefisso di una pagina non cambia a seconda di quante se ne
  // esportano insieme, e i file di due export successivi restano ordinabili.
  const allNames = pageFileNames(input.pages, input.format);
  const nameFor = new Map(input.pages.map((page, i) => [page.id, allNames[i]!]));

  const files: ExportFile[] = [];

  for (const page of pages) {
    const name = nameFor.get(page.id) ?? `${page.id}.${input.format}`;

    if (input.format === "json") {
      files.push({
        name,
        // Il documento *è* il prodotto (§1): esportarlo non è un ripiego per
        // chi non vuole le immagini, è l'unica forma rieditabile della pagina.
        data: JSON.stringify(page, null, 2),
        mediaType: "application/json",
      });
      continue;
    }

    const preview = renderPreview(page, input.font, input.scene, { draft: input.draft });
    if (!preview.svg) continue;

    if (input.format === "svg") {
      files.push({
        name,
        data: embedFont(preview.svg, LETTERING.font_family, input.fontBytes),
        mediaType: "image/svg+xml",
      });
      continue;
    }

    const withFont = embedFont(preview.svg, LETTERING.font_family, input.fontBytes);
    const blob = await svgToPngBlob(withFont, PAGE_WIDTH_PX, PAGE_HEIGHT_PX, { widthPx: input.widthPx });
    files.push({
      name,
      data: new Uint8Array(await blob.arrayBuffer()),
      mediaType: "image/png",
    });
  }

  return files;
}
