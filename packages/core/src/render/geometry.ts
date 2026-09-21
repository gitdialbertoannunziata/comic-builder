import type { Box } from "../layout/resolveLayout.js";
import type { Balloon } from "../schema/balloon.js";
import type { Page } from "../schema/page.js";
import type { LetteringFit } from "./types.js";

/**
 * Geometria di ciò che si disegna, per chi ci deve interagire sopra: l'editor
 * mette bersagli trascinabili esattamente dove il renderer ha disegnato. È
 * la stessa convenzione di `renderSvg` e sta qui perché le due cose non
 * possano divergere: un balloon che si afferra un po' più in là di dove si
 * vede è il tipo di difetto che fa sembrare rotto un editor.
 */

/** Il balloon occupa il box che parte dall'ancora (angolo in alto a sinistra) ed è grande quanto il suo fit. */
export function balloonBox(balloon: Pick<Balloon, "anchor">, panelBox: Box, fit: Pick<LetteringFit, "balloonWidth" | "balloonHeight">): Box {
  return {
    x: panelBox.x + balloon.anchor.x * panelBox.width,
    y: panelBox.y + balloon.anchor.y * panelBox.height,
    width: fit.balloonWidth,
    height: fit.balloonHeight,
  };
}

/** Dove punta la coda: il target esplicito, o il ripiego del renderer (corta, sotto il balloon). */
export function tailPoint(balloon: Pick<Balloon, "tail">, panelBox: Box, box: Box): { x: number; y: number } {
  if (balloon.tail.target) {
    return {
      x: panelBox.x + balloon.tail.target.x * panelBox.width,
      y: panelBox.y + balloon.tail.target.y * panelBox.height,
    };
  }
  return { x: box.x + box.width / 2, y: box.y + box.height + panelBox.height * 0.1 };
}

/** Inverso di `balloonBox`: la posizione di un box trascinato, come ancora normalizzata al pannello. */
export function anchorFor(boxX: number, boxY: number, panelBox: Box): { x: number; y: number } {
  return { x: (boxX - panelBox.x) / panelBox.width, y: (boxY - panelBox.y) / panelBox.height };
}

/**
 * Un tratto di gutter trascinabile: il confine fra la traccia `index` e la
 * successiva, dove separa davvero due pannelli. Dove un pannello attraversa
 * il confine (occupa entrambe le tracce), lì il gutter non c'è e non si
 * disegna una maniglia sopra l'arte.
 */
export interface GutterHandle {
  axis: "cols" | "rows";
  /** Confine fra la traccia `index` e `index + 1`. */
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function gutterHandles(page: Page, boxes: Map<string, Box>): GutterHandle[] {
  if (page.layout.mode !== "page") return [];
  const { cols, rows } = page.layout;
  const handles: GutterHandle[] = [];

  // Estensioni in px di ogni traccia, ricavate dai box: così le maniglie
  // seguono il layout risolto (gutter scalati compresi) senza ricalcolarlo.
  const colStart: number[] = [];
  const colEnd: number[] = [];
  const rowStart: number[] = [];
  const rowEnd: number[] = [];
  for (const panel of page.panels) {
    const box = boxes.get(panel.id);
    if (!box) continue;
    const { col, row, col_span, row_span } = panel.area;
    colStart[col] = Math.min(colStart[col] ?? Infinity, box.x);
    colEnd[col + col_span - 1] = Math.max(colEnd[col + col_span - 1] ?? -Infinity, box.x + box.width);
    rowStart[row] = Math.min(rowStart[row] ?? Infinity, box.y);
    rowEnd[row + row_span - 1] = Math.max(rowEnd[row + row_span - 1] ?? -Infinity, box.y + box.height);
  }

  const crosses = (axis: "cols" | "rows", boundary: number, other: number) =>
    page.panels.some((p) => {
      const [start, span, oStart, oSpan] =
        axis === "cols" ? [p.area.col, p.area.col_span, p.area.row, p.area.row_span] : [p.area.row, p.area.row_span, p.area.col, p.area.col_span];
      return start <= boundary && start + span - 1 > boundary && oStart <= other && oStart + oSpan > other;
    });

  for (let i = 0; i < cols.length - 1; i++) {
    const end = colEnd[i];
    const next = colStart[i + 1];
    if (end === undefined || next === undefined) continue;
    const x = (end + next) / 2;
    for (let r = 0; r < rows.length; r++) {
      if (crosses("cols", i, r)) continue;
      const y1 = rowStart[r];
      const y2 = rowEnd[r];
      if (y1 === undefined || y2 === undefined) continue;
      handles.push({ axis: "cols", index: i, x1: x, y1, x2: x, y2 });
    }
  }

  for (let i = 0; i < rows.length - 1; i++) {
    const end = rowEnd[i];
    const next = rowStart[i + 1];
    if (end === undefined || next === undefined) continue;
    const y = (end + next) / 2;
    for (let c = 0; c < cols.length; c++) {
      if (crosses("rows", i, c)) continue;
      const x1 = colStart[c];
      const x2 = colEnd[c];
      if (x1 === undefined || x2 === undefined) continue;
      handles.push({ axis: "rows", index: i, x1, y1: y, x2, y2: y });
    }
  }

  return mergeCollinear(handles);
}

/** Tratti contigui dello stesso confine diventano una maniglia sola. */
function mergeCollinear(handles: GutterHandle[]): GutterHandle[] {
  const out: GutterHandle[] = [];
  for (const h of handles) {
    const last = out[out.length - 1];
    const gap = 40; // tollera il gutter fra due righe (o colonne) consecutive
    if (last && last.axis === h.axis && last.index === h.index) {
      if (h.axis === "cols" && h.y1 - last.y2 <= gap) {
        last.y2 = h.y2;
        continue;
      }
      if (h.axis === "rows" && h.x1 - last.x2 <= gap) {
        last.x2 = h.x2;
        continue;
      }
    }
    out.push({ ...h });
  }
  return out;
}

/**
 * Nuovi pesi delle tracce dopo aver trascinato il confine `index` fino a
 * `position` (px). Cambiano solo le due tracce adiacenti e la loro somma
 * resta uguale: il resto della pagina non si muove. `minPx` impedisce di
 * schiacciare una traccia fino a farla sparire.
 */
export function dragTrackBoundary(
  weights: readonly number[],
  index: number,
  trackStart: number,
  pairPx: number,
  position: number,
  gutterPx: number,
  minPx = 48,
): number[] {
  const firstPx = Math.min(pairPx - minPx, Math.max(minPx, position - trackStart - gutterPx / 2));
  const pairWeight = weights[index]! + weights[index + 1]!;
  const next = [...weights];
  next[index] = (pairWeight * firstPx) / pairPx;
  next[index + 1] = pairWeight - next[index]!;
  return next;
}

/**
 * Dove sta l'arte dentro il pannello (§7.4): il rettangolo in cui si disegna
 * l'immagine intera, prima del ritaglio sul bordo del pannello.
 *
 * `cover` la adatta a riempire il pannello, `contain` a entrarci intera; lo
 * zoom moltiplica quell'adattamento; il punto `focus` dell'immagine finisce
 * al centro del pannello. Senza le dimensioni dell'immagine non si può
 * calcolare nulla: il chiamante ripiega sul riempimento centrato.
 */
export interface ArtFrameLike {
  fit?: "cover" | "contain";
  zoom?: number;
  focus_x?: number;
  focus_y?: number;
}

export function artPlacement(panelBox: Box, size: { width: number; height: number }, frame: ArtFrameLike = {}): Box {
  const fitScale =
    (frame.fit ?? "cover") === "cover"
      ? Math.max(panelBox.width / size.width, panelBox.height / size.height)
      : Math.min(panelBox.width / size.width, panelBox.height / size.height);
  const scale = fitScale * (frame.zoom ?? 1);
  const width = size.width * scale;
  const height = size.height * scale;
  return {
    x: panelBox.x + panelBox.width / 2 - (frame.focus_x ?? 0.5) * width,
    y: panelBox.y + panelBox.height / 2 - (frame.focus_y ?? 0.5) * height,
    width,
    height,
  };
}
