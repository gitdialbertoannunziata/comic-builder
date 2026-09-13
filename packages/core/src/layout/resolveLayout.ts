import type { Page, PageLayout, StripLayout } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";

/** Box in pixel. Non si salva mai nel documento (§5.8 regola 2, §7.1): esiste solo qui e nel renderer. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Distribuisce pesi `fr` su uno spazio disponibile, al netto dei gutter fra tracce.
 * Pura: stesso input, stesso output, nessuno stato.
 */
function resolveTrackSizes(weights: number[], available: number, gutter: number): number[] {
  const gutterTotal = gutter * Math.max(0, weights.length - 1);
  const usable = Math.max(0, available - gutterTotal);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (weightSum === 0 ? 0 : (w / weightSum) * usable));
}

function trackOffsets(sizes: number[], gutter: number): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const size of sizes) {
    offsets.push(acc);
    acc += size + gutter;
  }
  return offsets;
}

export interface ResolvedGrid {
  colOffsets: number[];
  colSizes: number[];
  rowOffsets: number[];
  rowSizes: number[];
}

/** Espande `cols`/`rows` (pesi fr) in offset e dimensioni assolute, dato lo spazio contenuto (pagina meno margini). */
export function resolveGrid(layout: PageLayout, contentWidth: number, contentHeight: number): ResolvedGrid {
  const colSizes = resolveTrackSizes(layout.cols, contentWidth, layout.gutter.x);
  const rowSizes = resolveTrackSizes(layout.rows, contentHeight, layout.gutter.y);
  return {
    colOffsets: trackOffsets(colSizes, layout.gutter.x),
    colSizes,
    rowOffsets: trackOffsets(rowSizes, layout.gutter.y),
    rowSizes,
  };
}

function boxForArea(grid: ResolvedGrid, area: Panel["area"], originX: number, originY: number): Box {
  const x = originX + (grid.colOffsets[area.col] ?? 0);
  const y = originY + (grid.rowOffsets[area.row] ?? 0);

  const lastCol = area.col + area.col_span - 1;
  const lastRow = area.row + area.row_span - 1;
  const colEnd =
    (grid.colOffsets[lastCol] ?? 0) + (grid.colSizes[lastCol] ?? 0);
  const rowEnd =
    (grid.rowOffsets[lastRow] ?? 0) + (grid.rowSizes[lastRow] ?? 0);

  return {
    x,
    y,
    width: colEnd - (grid.colOffsets[area.col] ?? 0),
    height: rowEnd - (grid.rowOffsets[area.row] ?? 0),
  };
}

/**
 * Risolve i box di tutti i pannelli di una pagina in modalità `page` (§7.1).
 * `originX`/`originY` sono lo spigolo interno all'area sicura (dopo i margini).
 */
export function resolvePageLayout(
  layout: PageLayout,
  panels: Panel[],
  contentWidth: number,
  contentHeight: number,
  originX = 0,
  originY = 0,
): Map<string, Box> {
  const grid = resolveGrid(layout, contentWidth, contentHeight);
  const boxes = new Map<string, Box>();
  for (const panel of panels) {
    boxes.set(panel.id, boxForArea(grid, panel.area, originX, originY));
  }
  return boxes;
}

/**
 * Deriva la striscia verticale (§7.2, §4.1) dai box già risolti della pagina canonica:
 * la striscia non è ridisegnata, eredita l'aspect ratio di ciascun pannello e impila
 * in sequenza, alla larghezza della striscia.
 */
export function resolveStripFromPage(
  layout: StripLayout,
  sourceBoxes: Map<string, Box>,
  stripWidth: number,
): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const width = stripWidth * layout.width_ratio;
  let y = 0;

  for (const panelId of layout.sequence) {
    const source = sourceBoxes.get(panelId);
    if (!source) continue;
    const aspect = source.width / source.height;
    const height = width / aspect;
    boxes.set(panelId, { x: 0, y, width, height });
    y += height + layout.panel_gap;
  }

  return boxes;
}

export function resolvePage(
  page: Page,
  contentWidth: number,
  contentHeight: number,
  originX = 0,
  originY = 0,
): Map<string, Box> {
  if (page.layout.mode === "page") {
    return resolvePageLayout(page.layout, page.panels, contentWidth, contentHeight, originX, originY);
  }
  throw new Error(
    "resolvePage richiede una pagina in modalità 'page'; per la modalità 'strip' usa resolveStripFromPage a partire dai box della pagina canonica.",
  );
}
