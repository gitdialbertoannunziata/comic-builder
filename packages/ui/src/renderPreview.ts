import {
  pageForTarget,
  pageRenderConfig,
  resolvePageBoxesForTarget,
  resolvePageTargetGeometry,
  scaleStyles,
  renderPageSvg,
  type PageTarget,
  validateDocument,
  lintPage,
  type Scene,
  type Page,
  type ValidationIssue,
  type RenderConfig,
  type Box,
  type LetteringFit,
} from "@comic-builder/core";
import { computePageFits, type LoadedFont } from "@comic-builder/lettering";
import { primaryGeometry, primaryTarget, project, styles } from "./project.js";

export const PAGE_WIDTH_PX = primaryGeometry.width;
export const PAGE_HEIGHT_PX = primaryGeometry.height;
export const TARGET = primaryTarget.id;
export const LETTERING = styles.lettering;


export interface PreviewResult {
  svg: string | null;
  issues: ValidationIssue[];
  /**
   * Box dei pannelli nello stesso sistema di coordinate dell'SVG: servono alla
   * UI per mettere sopra la pagina i bersagli cliccabili, così si seleziona un
   * pannello indicandolo invece che cercandolo in un elenco.
   */
  boxes: Map<string, Box>;
  /** Misure del lettering: dicono quanto è grande ogni balloon, per afferrarlo dove si vede. */
  fits: Map<string, LetteringFit>;
  width: number;
  height: number;
  /** Il formato mostrato, e la pagina com'è in quel formato (override applicati). */
  targetId: string;
  shownPage: Page;
}

/**
 * Pura: pagina + font in ingresso, SVG + esiti di validateDocument in uscita.
 * Stessa pipeline usata dai test golden del Core, qui eseguita nel browser
 * invece che in Node — nessun ramo di codice diverso fra i due.
 */
export interface RenderPreviewOptions {
  /** Spegne il layer bozza: nell'export finale un pannello non disegnato è vuoto, non un foglio di spoglio. */
  draft?: boolean;
  /** Arte per pannello (blob URL): il documento sa solo il percorso, l'host sa dove sono i byte. */
  art?: ReadonlyMap<string, string>;
  /** Formato pagina da mostrare; di default il canonico. */
  targetId?: string;
}

/** I formati pagina del progetto, nell'ordine dichiarato: quelli che l'anteprima sa mostrare. */
export const pageTargets: PageTarget[] = project.targets.filter((t): t is PageTarget => t.kind === "page");

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

  const target = pageTargets.find((t) => t.id === options.targetId) ?? primaryTarget;
  if (page.layout.mode !== "page") {
    return { svg: null, issues, boxes: new Map(), fits: new Map(), width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, targetId: target.id, shownPage: page };
  }

  // Stessa catena dell'export (planTargetExport): geometria del formato,
  // lettering in unità di pagina, override dei balloon per quel formato.
  // Ciò che si sistema qui è ciò che esce.
  const geometry = target.id === primaryTarget.id ? primaryGeometry : resolvePageTargetGeometry(target, project);
  const scaled = scaleStyles(styles, geometry.letteringScale);
  const shown = pageForTarget(page, target.id);
  const boxes = resolvePageBoxesForTarget(shown, geometry);
  const fits = computePageFits({
    page: shown,
    boxes,
    font,
    lettering: scaled.lettering,
    draftStyle: scaled.draftStyle,
    target: primaryTarget.id,
    draft,
  });
  const config: RenderConfig = {
    ...pageRenderConfig(geometry, scaled, { draft, artTarget: primaryTarget.id }),
    ...(options.art ? { art: options.art } : {}),
  };

  return {
    svg: renderPageSvg(shown, boxes, fits, config),
    issues,
    boxes,
    fits,
    width: geometry.width,
    height: geometry.height,
    targetId: target.id,
    shownPage: shown,
  };
}
