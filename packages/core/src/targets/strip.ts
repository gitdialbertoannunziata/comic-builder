import type { Box } from "../layout/resolveLayout.js";
import type { Page } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Balloon } from "../schema/balloon.js";
import type { StripTarget } from "../schema/project.js";
import type { LetteringFit } from "../render/types.js";
import type { PageTargetGeometry } from "./geometry.js";
import { resolvePageBoxesForTarget } from "./pageTarget.js";

/**
 * La striscia di un episodio (§7.2), derivata dalle pagine canoniche (§4.1
 * regola 1): i pannelli di tutte le pagine del capitolo, in ordine di pagina
 * e poi di lettura, impilati alla larghezza della striscia.
 *
 * Ogni pannello conserva il rapporto che ha nella pagina canonica: la
 * stessa arte vale in entrambi i formati, senza ridisegnare nulla. Di norma
 * occupa tutta la larghezza; se così diventerebbe più alto di `panel_max_h`,
 * si restringe e si centra. Senza quel tetto un pannello stretto (un terzo di
 * pagina) diventava alto più di una slice, e *ogni* taglio dell'episodio
 * cadeva dentro l'arte — misurato sul capitolo d'esempio: 100% delle pagine
 * da controllare, contro il 20% ammesso dal gate di F2.1 (§12.2).
 */
export interface StripPlacement {
  pageId: string;
  panel: Panel;
  box: Box;
}

export interface EpisodeStrip {
  targetId: string;
  width: number;
  height: number;
  placements: StripPlacement[];
  /** Estensione verticale di ogni pagina nella striscia: serve a dire *quale pagina* ha un taglio da controllare. */
  pageSpans: Array<{ pageId: string; y: number; height: number }>;
  /** Corpo del lettering rispetto alla pagina canonica (vedi `lettering_scale`). */
  letteringScale: number;
}

function sortedPages(pages: readonly Page[]): Page[] {
  return [...pages].sort((a, b) => a.order - b.order);
}

function panelsInReadingOrder(page: Page): Panel[] {
  if (page.layout.mode !== "page") return [...page.panels];
  const byId = new Map(page.panels.map((p) => [p.id, p]));
  return page.layout.reading_order.map((id) => byId.get(id)).filter((p): p is Panel => p !== undefined);
}

export function resolveEpisodeStrip(
  pages: readonly Page[],
  target: StripTarget,
  canonical: PageTargetGeometry,
): EpisodeStrip {
  const width = target.width_px;
  const maxHeight = target.panel_max_h ?? target.slice_max_h;
  const placements: StripPlacement[] = [];
  const pageSpans: EpisodeStrip["pageSpans"] = [];
  let y = 0;

  sortedPages(pages).forEach((page, pageIndex) => {
    if (pageIndex > 0) y += target.page_gap;
    const top = y;
    const canonicalBoxes = resolvePageBoxesForTarget(page, canonical);

    panelsInReadingOrder(page).forEach((panel, panelIndex) => {
      const source = canonicalBoxes.get(panel.id);
      if (!source || source.width <= 0 || source.height <= 0) return;
      if (panelIndex > 0) y += target.panel_gap;
      const ratio = source.height / source.width;
      let panelWidth = width;
      let height = width * ratio;
      if (height > maxHeight) {
        height = maxHeight;
        panelWidth = height / ratio;
      }
      placements.push({ pageId: page.id, panel, box: { x: (width - panelWidth) / 2, y, width: panelWidth, height } });
      y += height;
    });

    pageSpans.push({ pageId: page.id, y: top, height: y - top });
  });

  return {
    targetId: target.id,
    width,
    height: y,
    placements,
    pageSpans,
    // Unità di pagina (§8.1): la "pagina" della striscia è la sua larghezza.
    letteringScale: (width / canonical.trim.width) * target.lettering_scale,
  };
}

/** Intervallo verticale occupato da qualcosa che il taglio non deve attraversare. */
export interface Obstacle {
  y: number;
  height: number;
  kind: "balloon" | "band";
  pageId: string;
  /** Id del balloon, o del pannello per una banda manuale. */
  id: string;
}

function balloonExtent(balloon: Balloon, box: Box, fit: LetteringFit): { top: number; bottom: number } {
  const top = box.y + balloon.anchor.y * box.height;
  let bottom = top + fit.balloonHeight;
  let upper = top;
  // La coda fa parte del balloon: tagliarla a metà è lo stesso errore.
  if (balloon.tail.mode !== "none" && balloon.type !== "caption" && balloon.type !== "sfx") {
    const tailY = balloon.tail.target
      ? box.y + balloon.tail.target.y * box.height
      : top + fit.balloonHeight + box.height * 0.1; // stesso ripiego del renderer
    bottom = Math.max(bottom, tailY);
    upper = Math.min(upper, tailY);
  }
  return { top: upper, bottom };
}

/**
 * Tutto ciò che un taglio non deve attraversare: i balloon (con la coda),
 * misurati col fit reale del lettering, e le bande che l'autore ha segnato
 * sui pannelli (§7.2 — i volti, in v1).
 */
export function stripObstacles(strip: EpisodeStrip, fits: Map<string, LetteringFit>): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const { pageId, panel, box } of strip.placements) {
    for (const balloon of panel.balloons) {
      const fit = fits.get(balloon.id);
      if (!fit) continue;
      const { top, bottom } = balloonExtent(balloon, box, fit);
      obstacles.push({ y: top, height: bottom - top, kind: "balloon", pageId, id: balloon.id });
    }
    for (const band of panel.slice_avoid) {
      obstacles.push({
        y: box.y + band.from * box.height,
        height: (band.to - band.from) * box.height,
        kind: "band",
        pageId,
        id: panel.id,
      });
    }
  }
  return obstacles;
}
