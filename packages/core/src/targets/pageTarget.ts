import { resolvePageLayout, type Box } from "../layout/resolveLayout.js";
import type { Page } from "../schema/page.js";
import type { BalloonStyle, DraftStyle, LetteringConfig } from "../schema/project.js";
import type { Balloon } from "../schema/balloon.js";
import type { RenderConfig } from "../render/types.js";
import type { PageTargetGeometry } from "./geometry.js";

/** Gli stili del progetto che hanno misure in pixel, e che quindi un target scala. */
export interface TargetStyles {
  lettering: LetteringConfig;
  balloonStyle: BalloonStyle;
  draftStyle: DraftStyle;
}

/**
 * Stili in unità di pagina (§8.1) portati alla scala di un target. I rapporti
 * (`line_height`, `max_width_ratio`, `safety_margin_ratio`, le frazioni del
 * layer bozza) non cambiano: sono già relativi.
 */
export function scaleStyles(styles: TargetStyles, factor: number): TargetStyles {
  const { lettering, balloonStyle, draftStyle } = styles;
  const scaleVisual = <T extends { stroke_width?: number | undefined; corner_radius_px?: number | undefined }>(v: T): T => ({
    ...v,
    ...(v.stroke_width !== undefined ? { stroke_width: v.stroke_width * factor } : {}),
    ...(v.corner_radius_px !== undefined ? { corner_radius_px: v.corner_radius_px * factor } : {}),
  });

  return {
    lettering: {
      ...lettering,
      base_size_px: lettering.base_size_px * factor,
      padding: lettering.padding * factor,
      tail_width: lettering.tail_width * factor,
    },
    balloonStyle: {
      base: scaleVisual(balloonStyle.base),
      by_type: Object.fromEntries(
        Object.entries(balloonStyle.by_type).map(([type, visual]) => [type, scaleVisual(visual)]),
      ) as BalloonStyle["by_type"],
    },
    draftStyle: { ...draftStyle, padding: draftStyle.padding * factor },
  };
}

function withTargetOverride(balloon: Balloon, targetId: string): Balloon {
  const override = balloon.per_target[targetId];
  if (!override) return balloon;
  return {
    ...balloon,
    ...(override.anchor ? { anchor: override.anchor } : {}),
    ...(override.tail ? { tail: override.tail } : {}),
    ...(override.font_scale !== undefined ? { font_scale: override.font_scale } : {}),
  };
}

/**
 * La pagina come la vede un target: gli override di posizionamento per
 * formato (§4.1 regola 3, §5.6) sostituiscono ancora, coda e corpo del
 * balloon. Il testo non ha override: il contenuto è uno solo, cambia solo
 * dove sta.
 */
export function pageForTarget(page: Page, targetId: string): Page {
  const touched = page.panels.some((p) => p.balloons.some((b) => b.per_target[targetId]));
  const overlayTouched = page.overlays.some((b) => b.per_target[targetId]);
  if (!touched && !overlayTouched) return page;
  return {
    ...page,
    panels: page.panels.map((panel) => ({
      ...panel,
      balloons: panel.balloons.map((b) => withTargetOverride(b, targetId)),
    })),
    overlays: page.overlays.map((b) => withTargetOverride(b, targetId)),
  };
}

/** Box dei pannelli nel canvas del target: stessa griglia, gutter alla scala del target. */
export function resolvePageBoxesForTarget(page: Page, geometry: PageTargetGeometry): Map<string, Box> {
  if (page.layout.mode !== "page") {
    throw new Error(`La pagina "${page.id}" non è in modalità 'page': un target pagina si risolve da una griglia.`);
  }
  const layout = {
    ...page.layout,
    gutter: { x: page.layout.gutter.x * geometry.scale, y: page.layout.gutter.y * geometry.scale },
  };
  const { content } = geometry;
  return resolvePageLayout(layout, page.panels, content.width, content.height, content.x, content.y);
}

export interface TargetRenderOptions {
  /** Il layer bozza (§5.5): acceso in anteprima, spento nell'export finale. */
  draft: boolean;
  /**
   * Target di cui guardare `panel.render` per sapere se un pannello ha arte.
   * Di norma lo stesso del render; un target derivato può dichiarare il suo.
   */
  artTarget?: string;
}

export function pageRenderConfig(
  geometry: PageTargetGeometry,
  styles: TargetStyles,
  options: TargetRenderOptions,
): RenderConfig {
  return {
    width: geometry.width,
    height: geometry.height,
    fontFamily: styles.lettering.font_family,
    lineHeight: styles.lettering.line_height,
    padding: styles.lettering.padding,
    tailWidthPx: styles.lettering.tail_width,
    balloonStyle: styles.balloonStyle,
    draftStyle: styles.draftStyle,
    baseFontSizePx: styles.lettering.base_size_px,
    target: options.artTarget ?? geometry.targetId,
    draft: options.draft,
    strokeScale: geometry.scale,
    // Una tavola esportata ha il fondo della carta, non la trasparenza: il
    // bleed in particolare deve uscire pieno, o lo stampatore taglia nel vuoto.
    background: "#ffffff",
    color: geometry.color,
  };
}
