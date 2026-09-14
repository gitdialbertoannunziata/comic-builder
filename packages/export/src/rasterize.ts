import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

export interface RasterizeOptions {
  /** Larghezza target in px; l'altezza segue il rapporto del viewBox dell'SVG. Default: dimensione naturale. */
  widthPx?: number;
  /**
   * Percorsi assoluti ai file font da usare (`project.fonts[].path`, §5.2): la
   * resa fedele del lettering dipende da questi, non dai font installati sulla
   * macchina che esporta. Se vuoto, ricade sui font di sistema.
   */
  fontFiles?: string[];
  /** Usato solo se `fontFiles` è vuoto — utile per sviluppo/test, sconsigliato in produzione (§8.4: font dichiarati per progetto). */
  loadSystemFonts?: boolean;
  background?: string;
}

export interface RasterizedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Rasterizza in PNG l'SVG prodotto da `@comic-builder/core` (`renderPageSvg` /
 * `renderStripSvg`), via resvg — motore conforme alla spec SVG, scelto dopo
 * aver verificato che il delegate SVG di ImageMagick si fermava al primo
 * `<tspan>` annidato durante lo sviluppo del renderer. Pacchetto separato dal
 * Core per la stessa ragione di `lettering`: l'export non è una dipendenza del
 * documento, solo dell'output finale (§11.2).
 */
export function rasterizeSvgToPng(svg: string, options: RasterizeOptions = {}): RasterizedImage {
  const font: NonNullable<ResvgRenderOptions["font"]> = {};
  if (options.fontFiles && options.fontFiles.length > 0) {
    font.fontFiles = options.fontFiles;
    font.loadSystemFonts = false;
  } else {
    font.loadSystemFonts = options.loadSystemFonts ?? true;
  }

  const renderOptions: ResvgRenderOptions = { font };
  if (options.widthPx !== undefined) {
    renderOptions.fitTo = { mode: "width", value: options.widthPx };
  }
  if (options.background !== undefined) {
    renderOptions.background = options.background;
  }

  const resvg = new Resvg(svg, renderOptions);
  const rendered = resvg.render();

  return {
    data: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
  };
}
