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
  /**
   * Margine di sicurezza oltre `padding`, come frazione di `fontSizePx` per lato
   * (`project.lettering.safety_margin_ratio`, §5.2 — default 0.15 se il progetto
   * non lo specifica). Assorbe lo scarto fra la misurazione a riga intera e il
   * render spezzato in più `<tspan>` ai confini dell'enfasi.
   */
  safetyMarginRatio?: number;
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
  /** Padding e margine di sicurezza (px) effettivamente applicati per lato, incluso il default se il chiamante non li ha specificati. */
  paddingPx: number;
  safetyMarginPx: number;
}

function computeBlockHeight(lines: Line[], fontSizePx: number, lineHeight: number): number {
  return lines.length * fontSizePx * lineHeight;
}

/**
 * Margine di sicurezza fra il blocco di testo misurato e il contorno del
 * balloon, oltre al `padding` dichiarato dal progetto. Non è decorativo: la
 * misurazione avviene su ogni riga come stringa unica (kerning applicato fra
 * ogni coppia di glifi), ma il renderer la spezza in più `<tspan>` ai confini
 * dell'enfasi (`em: bold|italic|small`) — la maggior parte dei motori SVG non
 * applica il kerning fra `<tspan>` diversi, quindi la larghezza realmente
 * renderizzata può differire di qualche pixel da quella misurata. Il margine
 * assorbe lo scarto qualunque sia il motore che disegna l'SVG finale, così il
 * testo non tocca mai il contorno (verificato visivamente con resvg).
 */
const DEFAULT_SAFETY_MARGIN_RATIO = 0.15;

function renderSafetyMarginPx(fontSizePx: number, ratio: number): number {
  return fontSizePx * ratio;
}

/**
 * Calcola la forma minima (larghezza/altezza del blocco di testo) che contiene
 * il contenuto più padding, riducendo `font_scale` se necessario (§8.1).
 * Non disegna nulla: il renderer SVG consuma `lines` + `fontSizePx`.
 */
export function fitBalloonText(input: FitBalloonInput): FitBalloonResult {
  const minScale = input.minFontScale ?? 0.6;
  const step = input.scaleStep ?? 0.05;
  const marginRatio = input.safetyMarginRatio ?? DEFAULT_SAFETY_MARGIN_RATIO;

  let scale = input.fontScale;
  let lines: Line[] = [];
  let fontSizePx = 0;
  let width = 0;
  let height = 0;
  let margin = 0;

  for (;;) {
    fontSizePx = input.baseFontSizePx * scale;
    lines = wrapText(input.runs, input.font, fontSizePx, input.maxWidthPx);
    width = blockWidth(lines, input.font, fontSizePx);
    height = computeBlockHeight(lines, fontSizePx, input.lineHeight);
    margin = renderSafetyMarginPx(fontSizePx, marginRatio);

    const totalHeight = height + input.padding * 2 + margin * 2;
    if (totalHeight <= input.maxHeightPx || scale <= minScale) break;
    scale = Math.max(minScale, scale - step);
  }

  const fits = height + input.padding * 2 + margin * 2 <= input.maxHeightPx;

  return {
    lines,
    fontSizePx,
    fontScale: scale,
    blockWidth: width,
    blockHeight: height,
    balloonWidth: width + (input.padding + margin) * 2,
    balloonHeight: height + (input.padding + margin) * 2,
    fits,
    paddingPx: input.padding,
    safetyMarginPx: margin,
  };
}
