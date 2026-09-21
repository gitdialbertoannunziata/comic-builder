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
function renderSvg(svg: string, options: RasterizeOptions) {
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

  return new Resvg(svg, renderOptions).render();
}

export function rasterizeSvgToPng(svg: string, options: RasterizeOptions = {}): RasterizedImage {
  const rendered = renderSvg(svg, options);
  return {
    data: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
  };
}

/**
 * Pixel RGBA grezzi, senza codifica PNG: servono ai test che confrontano
 * immagini pixel per pixel (per esempio la continuità fra slice consecutive
 * della striscia, §7.2), dove decodificare un PNG sarebbe solo rumore.
 */
export function rasterizeSvgToPixels(svg: string, options: RasterizeOptions = {}): RasterizedImage {
  const rendered = renderSvg(svg, options);
  return { data: new Uint8Array(rendered.pixels), width: rendered.width, height: rendered.height };
}
