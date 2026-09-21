import {
  resolvePageLayout,
  renderPageSvg,
  validateDocument,
  lintPage,
  type Scene,
  LetteringConfigSchema,
  BalloonStyleSchema,
  DraftStyleSchema,
  type Page,
  type ValidationIssue,
  type RenderConfig,
  type Box,
} from "@comic-builder/core";
import { computePageFits, type LoadedFont } from "@comic-builder/lettering";

export const PAGE_WIDTH_PX = 1600;
export const PAGE_HEIGHT_PX = 2400;
export const PAGE_MARGIN_PX = 56;
export const TARGET = "digital-page";

export const LETTERING = LetteringConfigSchema.parse({
  font_family: "Comic Neue",
  base_size_px: 26,
  line_height: 1.35,
  padding: 12,
  max_width_ratio: 0.62,
  tail_width: 10,
});

const BALLOON_STYLE = BalloonStyleSchema.parse({});
const DRAFT_STYLE = DraftStyleSchema.parse({});

export interface PreviewResult {
  svg: string | null;
  issues: ValidationIssue[];
  /**
   * Box dei pannelli nello stesso sistema di coordinate dell'SVG: servono alla
   * UI per mettere sopra la pagina i bersagli cliccabili, così si seleziona un
   * pannello indicandolo invece che cercandolo in un elenco.
   */
  boxes: Map<string, Box>;
  width: number;
  height: number;
}

/**
 * Pura: pagina + font in ingresso, SVG + esiti di validateDocument in uscita.
 * Stessa pipeline usata dai test golden del Core, qui eseguita nel browser
 * invece che in Node — nessun ramo di codice diverso fra i due.
 */
export interface RenderPreviewOptions {
  /** Spegne il layer bozza: nell'export finale un pannello non disegnato è vuoto, non un foglio di spoglio. */
  draft?: boolean;
}

export function renderPreview(
  page: Page,
  font: LoadedFont,
  scene?: Scene,
  options: RenderPreviewOptions = {},
): PreviewResult {
  const draft = options.draft ?? true;
  // Le due validazioni insieme: coerenza strutturale (§7.1) e qualità
  // secondo l'Appendice A. Sono separate nel Core perché rispondono a
  // domande diverse, ma per chi corregge una pagina sono un elenco solo.
  const issues = [
    ...validateDocument(page),
    ...lintPage(page, { target: TARGET, ...(scene ? { scene } : {}) }),
  ];

  if (page.layout.mode !== "page") {
    return { svg: null, issues, boxes: new Map(), width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX };
  }

  const boxes = resolvePageLayout(
    page.layout,
    page.panels,
    PAGE_WIDTH_PX - PAGE_MARGIN_PX * 2,
    PAGE_HEIGHT_PX - PAGE_MARGIN_PX * 2,
    PAGE_MARGIN_PX,
    PAGE_MARGIN_PX,
  );

  const fits = computePageFits({
    page,
    boxes,
    font,
    lettering: LETTERING,
    draftStyle: DRAFT_STYLE,
    target: TARGET,
    draft,
  });

  const config: RenderConfig = {
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
    fontFamily: LETTERING.font_family,
    lineHeight: LETTERING.line_height,
    padding: LETTERING.padding,
    tailWidthPx: LETTERING.tail_width,
    balloonStyle: BALLOON_STYLE,
    draftStyle: DRAFT_STYLE,
    baseFontSizePx: LETTERING.base_size_px,
    target: TARGET,
    draft,
  };

  return {
    svg: renderPageSvg(page, boxes, fits, config),
    issues,
    boxes,
    width: PAGE_WIDTH_PX,
    height: PAGE_HEIGHT_PX,
  };
}
