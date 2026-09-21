import type { Box } from "../layout/resolveLayout.js";
import type { Page } from "../schema/page.js";
import type { PageTargetGeometry } from "./geometry.js";

/**
 * Guided view (§4.2): i box dei pannelli che il Core calcola comunque per
 * disegnare la pagina *sono* i metadata di panel view dei lettori digitali.
 *
 * Il formato qui è neutro e documentato: rettangoli normalizzati al formato
 * finito (non al canvas col bleed), in ordine di lettura. Ogni piattaforma ne
 * vuole una traduzione diversa (Kindle, Comixology, Kobo): quella è un
 * adattatore sottile a valle, non una decisione del modello dati.
 */
export interface PanelRegion {
  panel: string;
  /** Posizione nell'ordine di lettura, da 1. */
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageRegions {
  page: string;
  order: number;
  /** Nome del file immagine a cui le regioni si riferiscono. */
  image: string;
  reading_direction: "ltr" | "rtl";
  regions: PanelRegion[];
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export function pageRegions(
  page: Page,
  boxes: Map<string, Box>,
  geometry: PageTargetGeometry,
  image: string,
  readingDirection: "ltr" | "rtl",
): PageRegions {
  const order = page.layout.mode === "page" ? page.layout.reading_order : page.layout.sequence;
  const { trim } = geometry;
  const regions: PanelRegion[] = [];

  order.forEach((panelId) => {
    const box = boxes.get(panelId);
    if (!box) return;
    // Ritagliato al formato finito: un pannello al vivo esce nel bleed, ma chi
    // legge vede solo la pagina tagliata.
    const x0 = Math.max(box.x, trim.x);
    const y0 = Math.max(box.y, trim.y);
    const x1 = Math.min(box.x + box.width, trim.x + trim.width);
    const y1 = Math.min(box.y + box.height, trim.y + trim.height);
    regions.push({
      panel: panelId,
      order: regions.length + 1,
      x: round((x0 - trim.x) / trim.width),
      y: round((y0 - trim.y) / trim.height),
      width: round((x1 - x0) / trim.width),
      height: round((y1 - y0) / trim.height),
    });
  });

  return { page: page.id, order: page.order, image, reading_direction: readingDirection, regions };
}
