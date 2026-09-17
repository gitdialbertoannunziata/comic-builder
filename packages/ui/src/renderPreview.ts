import {
  resolvePageLayout,
  renderPageSvg,
  validateDocument,
  LetteringConfigSchema,
  BalloonStyleSchema,
  type Page,
  type ValidationIssue,
  type RenderConfig,
  type LetteringFit,
} from "@comic-builder/core";
import { fitBalloonText, type LoadedFont } from "@comic-builder/lettering";

export const PAGE_WIDTH_PX = 1600;
export const PAGE_HEIGHT_PX = 2400;
export const PAGE_MARGIN_PX = 56;

export const LETTERING = LetteringConfigSchema.parse({
  font_family: "Comic Neue",
  base_size_px: 26,
  line_height: 1.35,
  padding: 12,
  max_width_ratio: 0.62,
  tail_width: 10,
});

const BALLOON_STYLE = BalloonStyleSchema.parse({});

export interface PreviewResult {
  svg: string | null;
  issues: ValidationIssue[];
}

/**
 * Pura: pagina + font in ingresso, SVG + esiti di validateDocument in uscita.
 * Stessa pipeline usata dai test golden del Core, qui eseguita nel browser
 * invece che in Node — nessun ramo di codice diverso fra i due.
 */
export function renderPreview(page: Page, font: LoadedFont): PreviewResult {
  const issues = validateDocument(page);

  if (page.layout.mode !== "page") {
    return { svg: null, issues };
  }

  const boxes = resolvePageLayout(
    page.layout,
    page.panels,
    PAGE_WIDTH_PX - PAGE_MARGIN_PX * 2,
    PAGE_HEIGHT_PX - PAGE_MARGIN_PX * 2,
    PAGE_MARGIN_PX,
    PAGE_MARGIN_PX,
  );

  const fits = new Map<string, LetteringFit>();
  for (const panel of page.panels) {
    const box = boxes.get(panel.id);
    if (!box) continue;
    for (const balloon of panel.balloons) {
      const result = fitBalloonText({
        runs: balloon.text,
        font,
        baseFontSizePx: LETTERING.base_size_px,
        fontScale: balloon.font_scale,
        lineHeight: LETTERING.line_height,
        padding: LETTERING.padding,
        safetyMarginRatio: LETTERING.safety_margin_ratio,
        maxWidthPx: box.width * LETTERING.max_width_ratio,
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

  const config: RenderConfig = {
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
    fontFamily: LETTERING.font_family,
    lineHeight: LETTERING.line_height,
    padding: LETTERING.padding,
    tailWidthPx: LETTERING.tail_width,
    balloonStyle: BALLOON_STYLE,
  };

  return { svg: renderPageSvg(page, boxes, fits, config), issues };
}
