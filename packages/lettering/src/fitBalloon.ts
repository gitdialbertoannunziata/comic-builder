import type { TextRun } from "@comic-builder/core";
import type { LoadedFont } from "./font.js";
import { wrapText, blockWidth, type Line } from "./reflow.js";

export interface FitBalloonInput {
  runs: TextRun[];
  font: LoadedFont;
  /**
   * Dimensione font già scalata per il target di render (§8.1: `base_size_px` è
   * riferito alla larghezza di pagina). Il chiamante calcola
   * `project.lettering.base_size_px * (targetWidthPx / primaryTargetWidthPx)`
   * prima di arrivare qui: questo modulo non conosce i target, solo i pixel.
   */
  baseFontSizePx: number;
  /** `balloon.font_scale` di partenza. */
  fontScale: number;
  lineHeight: number;
  padding: number;
  maxWidthPx: number;
  maxHeightPx: number;
  minFontScale?: number;
  scaleStep?: number;
}

export interface FitBalloonResult {
  lines: Line[];
  fontSizePx: number;
  fontScale: number;
  blockWidth: number;
  blockHeight: number;
  balloonWidth: number;
  balloonHeight: number;
  /** false se anche al `minFontScale` il testo eccede `maxHeightPx` (§8.1: mai testo che esce dal balloon senza avviso). */
  fits: boolean;
}

function computeBlockHeight(lines: Line[], fontSizePx: number, lineHeight: number): number {
  return lines.length * fontSizePx * lineHeight;
}

/**
 * Calcola la forma minima (larghezza/altezza del blocco di testo) che contiene
 * il contenuto più padding, riducendo `font_scale` se necessario (§8.1).
 * Non disegna nulla: il renderer SVG consuma `lines` + `fontSizePx`.
 */
export function fitBalloonText(input: FitBalloonInput): FitBalloonResult {
  const minScale = input.minFontScale ?? 0.6;
  const step = input.scaleStep ?? 0.05;

  let scale = input.fontScale;
  let lines: Line[] = [];
  let fontSizePx = 0;
  let width = 0;
  let height = 0;

  for (;;) {
    fontSizePx = input.baseFontSizePx * scale;
    lines = wrapText(input.runs, input.font, fontSizePx, input.maxWidthPx);
    width = blockWidth(lines, input.font, fontSizePx);
    height = computeBlockHeight(lines, fontSizePx, input.lineHeight);

    const totalHeight = height + input.padding * 2;
    if (totalHeight <= input.maxHeightPx || scale <= minScale) break;
    scale = Math.max(minScale, scale - step);
  }

  const fits = height + input.padding * 2 <= input.maxHeightPx;

  return {
    lines,
    fontSizePx,
    fontScale: scale,
    blockWidth: width,
    blockHeight: height,
    balloonWidth: width + input.padding * 2,
    balloonHeight: height + input.padding * 2,
    fits,
  };
}
