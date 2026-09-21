import {
  panelNeedsDraft,
  draftActionFontSizePx,
  type Page,
  type Box,
  type LetteringFit,
  type LetteringConfig,
  type DraftStyle,
  type MeasureFits,
} from "@comic-builder/core";
import type { LoadedFont } from "./font.js";
import { fitBalloonTextCached } from "./fitCache.js";

export interface ComputePageFitsInput {
  page: Page;
  /** Box dei pannelli già risolti da `resolveLayout`: il fit dipende dallo spazio reale. */
  boxes: Map<string, Box>;
  font: LoadedFont;
  lettering: LetteringConfig;
  draftStyle: DraftStyle;
  target: string;
  /** Se falso, non misura il testo dell'azione: l'export finale non disegna la bozza. */
  draft?: boolean;
}

/**
 * Misura tutto ciò che la pagina deve scrivere e restituisce una sola mappa,
 * indicizzata per id: i balloon per il loro id, il testo dell'azione del layer
 * bozza per l'id del pannello che lo contiene. È il passo che sta fra
 * `resolveLayout` e il renderer — separato perché qui servono i glifi reali
 * (opentype.js), e il Core non li può vedere (§11.2).
 */
export function computePageFits(input: ComputePageFitsInput): Map<string, LetteringFit> {
  const { page, boxes, font, lettering, draftStyle, target } = input;
  const fits = new Map<string, LetteringFit>();
  const withDraft = input.draft ?? true;

  for (const panel of page.panels) {
    const box = boxes.get(panel.id);
    if (!box) continue;

    if (withDraft && panelNeedsDraft(panel, target) && panel.action.trim().length > 0) {
      const fontSizePx = draftActionFontSizePx(draftStyle, lettering.base_size_px);
      const result = fitBalloonTextCached({
        runs: [{ t: panel.action }],
        font,
        baseFontSizePx: fontSizePx,
        fontScale: 1,
        lineHeight: lettering.line_height,
        padding: 0,
        safetyMarginRatio: lettering.safety_margin_ratio,
        // Margine esplicito, non la larghezza utile piena. La misurazione dei
        // glifi e ciò che un motore disegna davvero divergono fino a qualche
        // punto percentuale (misurato nel browser: una riga data per ≤459px
        // ne occupava 505), e su una riga lunga quella percentuale vale più
        // del padding. I balloon assorbono lo scarto col loro padding più il
        // margine di sicurezza; il testo della bozza, che arriva quasi al
        // bordo del pannello, no — quindi il margine glielo si dà qui.
        // Un'annotazione non ha comunque motivo di toccare i bordi.
        maxWidthPx: (box.width - draftStyle.padding * 2) * 0.82,
        // Metà altezza: il resto serve a badge dell'inquadratura e cast, che
        // stanno ai bordi e non devono finirci sotto.
        maxHeightPx: box.height * 0.5,
      });
      fits.set(panel.id, {
        lines: result.lines,
        fontSizePx: result.fontSizePx,
        blockHeight: result.blockHeight,
        balloonWidth: result.balloonWidth,
        balloonHeight: result.balloonHeight,
      });
    }

    for (const balloon of panel.balloons) {
      const result = fitBalloonTextCached({
        runs: balloon.text,
        font,
        baseFontSizePx: lettering.base_size_px,
        fontScale: balloon.font_scale,
        lineHeight: lettering.line_height,
        padding: lettering.padding,
        safetyMarginRatio: lettering.safety_margin_ratio,
        maxWidthPx: box.width * lettering.max_width_ratio,
        maxHeightPx: box.height * 0.9,
      });
      fits.set(balloon.id, {
        lines: result.lines,
        fontSizePx: result.fontSizePx,
        blockHeight: result.blockHeight,
        balloonWidth: result.balloonWidth,
        balloonHeight: result.balloonHeight,
      });
    }
  }

  return fits;
}

/**
 * La misura del testo nella forma che il piano d'export del Core si aspetta
 * (`MeasureFits`): il Core decide cosa misurare e dove, questo pacchetto
 * misura con i glifi veri.
 */
export function measureWith(font: LoadedFont): MeasureFits {
  return ({ page, boxes, lettering, draftStyle, target, draft }) =>
    computePageFits({ page, boxes, font, lettering, draftStyle, target, draft });
}
