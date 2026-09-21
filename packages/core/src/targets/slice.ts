import type { EpisodeStrip, Obstacle } from "./strip.js";

/**
 * Slicing della striscia (§7.2): dove tagliare un episodio in immagini.
 *
 * È un algoritmo, e il piano chiede di trattarlo come tale: niente euristica
 * greedy "taglia al primo gutter utile", che funziona sulle pagine di prova e
 * spezza un balloon alla prima pagina fitta. Qui è una programmazione
 * dinamica sui punti di taglio candidati, con costi dichiarati:
 *
 * - **gutter** (fra due pannelli o due pagine): costo 0, è il taglio giusto;
 * - **dentro un pannello**, lontano da balloon e bande: costo 1, ammesso ma da
 *   controllare, perché l'arte che attraversa non è nota (un volto, §7.2);
 * - **attraverso un balloon o una banda**: costo proibitivo, scelto solo se
 *   non esiste alternativa (un balloon più alto di una slice).
 *
 * A parità di costo vince la soluzione con meno immagini. Il massimo è
 * rigido (è il limite della piattaforma). Il minimo no: una slice sotto il
 * minimo costa 0,5 — meno di un taglio nell'arte, più di uno nel gutter.
 * Da vincolo rigido produceva il caso peggiore: un pannello basso fra due
 * alti (545 px fra due da 1280) non stava in nessuna slice ammessa, e
 * l'unica soluzione era tagliare dentro l'arte — misurato su un episodio di
 * 12 pagine, il 33% delle pagine da ritoccare. Una slice corta è innocua;
 * un taglio nell'arte è lavoro a mano. L'ultima slice dell'episodio può
 * essere bassa senza costo: lì la storia finisce.
 */

export type CutKind = "gutter" | "panel" | "obstacle";

export interface SliceCut {
  y: number;
  kind: CutKind;
  /** Pagina in cui cade il taglio (per un gutter fra pagine, quella che finisce). */
  pageId: string | null;
  /** Per un taglio `obstacle`: cosa viene attraversato. */
  crosses: Obstacle[];
}

export interface Slice {
  index: number;
  /** Porzione di striscia che la slice rappresenta. */
  y: number;
  height: number;
  /** Altezza dell'immagine: `height` più la sovrapposizione, salvo l'ultima. */
  imageHeight: number;
  /** Sotto l'altezza minima (e non è l'ultima): ammessa per non tagliare l'arte, ma dichiarata. */
  short: boolean;
}

export interface SlicePlan {
  slices: Slice[];
  /** Tagli interni (non include 0 e la fine della striscia). */
  cuts: SliceCut[];
  /**
   * La metrica del gate di F2.1 (§12.2): quante pagine hanno almeno un taglio
   * da ritoccare. `obstacle` è sempre da ritoccare; `panel` è da controllare,
   * e conta, perché senza guardare l'arte non si può escludere un volto.
   */
  report: {
    pages: number;
    pagesToCheck: string[];
    pagesWithBrokenBalloons: string[];
    /** `pagesToCheck.length / pages`: il gate chiede meno del 20%. */
    checkRatio: number;
    /** Slice sotto il minimo scelte per evitare un taglio nell'arte. */
    shortSlices: number;
  };
}

export interface SliceOptions {
  maxHeight: number;
  minHeight: number;
  overlapPx: number;
  /** Passo dei candidati dentro i pannelli, in px. Più fine = più lento, non più corretto. */
  step?: number;
}

const COST: Record<CutKind, number> = { gutter: 0, panel: 1, obstacle: 1000 };
/** Una slice sotto il minimo: preferibile a un taglio nell'arte, non a un taglio nel gutter. */
const SHORT_SLICE = 0.5;
/** Costo di ogni immagine in più: rompe i pareggi a favore di meno slice, senza mai battere un taglio migliore. */
const PER_SLICE = 0.001;

interface Candidate {
  y: number;
  kind: CutKind;
  pageId: string | null;
  crosses: Obstacle[];
}

function crossing(y: number, obstacles: readonly Obstacle[]): Obstacle[] {
  // Taglio *strettamente* dentro: un taglio sul bordo di un balloon non lo spezza.
  return obstacles.filter((o) => y > o.y && y < o.y + o.height);
}

function pageAt(strip: EpisodeStrip, y: number): string | null {
  const span = strip.pageSpans.find((s) => y >= s.y && y <= s.y + s.height);
  return span?.pageId ?? null;
}

function candidates(strip: EpisodeStrip, obstacles: readonly Obstacle[], step: number): Candidate[] {
  const byY = new Map<number, Candidate>();
  const add = (y: number, kind: CutKind) => {
    const rounded = Math.round(y);
    if (rounded <= 0 || rounded >= Math.round(strip.height)) return;
    const crosses = crossing(rounded, obstacles);
    const effective: CutKind = crosses.length > 0 ? "obstacle" : kind;
    const existing = byY.get(rounded);
    // Se lo stesso y è sia bordo di pannello sia interno, vale il tipo migliore.
    if (existing && COST[existing.kind] <= COST[effective]) return;
    byY.set(rounded, { y: rounded, kind: effective, pageId: pageAt(strip, rounded), crosses });
  };

  const placements = [...strip.placements].sort((a, b) => a.box.y - b.box.y);
  let previousEnd = 0;
  for (const { box } of placements) {
    // Gutter: il bordo stesso e ogni punto dello spazio vuoto prima del pannello.
    add(box.y, "gutter");
    for (let y = previousEnd; y < box.y; y += step) add(y, "gutter");
    for (let y = box.y + step; y < box.y + box.height; y += step) add(y, "panel");
    previousEnd = box.y + box.height;
    add(previousEnd, "gutter");
  }
  for (let y = previousEnd; y < strip.height; y += step) add(y, "gutter");

  return [...byY.values()].sort((a, b) => a.y - b.y);
}

export function sliceStrip(strip: EpisodeStrip, obstacles: readonly Obstacle[], options: SliceOptions): SlicePlan {
  const { maxHeight, minHeight, overlapPx } = options;
  const step = options.step ?? 4;
  if (minHeight > maxHeight) throw new Error("sliceStrip: minHeight supera maxHeight");
  // Con candidati ogni `step` px, una finestra più stretta del passo potrebbe
  // non contenerne nessuno: allora nessun taglio sarebbe ammissibile.
  if (maxHeight - minHeight < step) throw new Error("sliceStrip: la finestra [min, max] è più stretta del passo");

  const total = Math.round(strip.height);
  const points: Candidate[] = [
    { y: 0, kind: "gutter", pageId: null, crosses: [] },
    ...candidates(strip, obstacles, step),
    { y: total, kind: "gutter", pageId: null, crosses: [] },
  ];
  const last = points.length - 1;

  const best = new Array<number>(points.length).fill(Infinity);
  const from = new Array<number>(points.length).fill(-1);
  best[0] = 0;

  // Finestra scorrevole sui predecessori ammissibili: per ogni punto, quelli
  // fra y-max e y-min. I punti sono ordinati, quindi basta un indice.
  let lo = 0;
  for (let i = 1; i <= last; i++) {
    const point = points[i]!;
    const isEnd = i === last;
    while (lo < i && point.y - points[lo]!.y > maxHeight) lo++;
    const cost = isEnd ? 0 : COST[point.kind];

    for (let j = lo; j < i; j++) {
      const height = point.y - points[j]!.y;
      if (height <= 0) break;
      const short = !isEnd && height < minHeight ? SHORT_SLICE : 0;
      const candidate = best[j]! + cost + short + PER_SLICE;
      if (candidate < best[i]!) {
        best[i] = candidate;
        from[i] = j;
      }
    }
  }

  if (!Number.isFinite(best[last]!)) {
    // Non succede con candidati densi e una finestra valida; se succede è un
    // difetto dell'algoritmo, non un caso da gestire in silenzio.
    throw new Error("sliceStrip: nessuna sequenza di tagli ammissibile");
  }

  const chain: number[] = [];
  for (let i = last; i > 0; i = from[i]!) chain.push(i);
  chain.reverse();

  const cuts: SliceCut[] = chain.slice(0, -1).map((i) => {
    const p = points[i]!;
    return { y: p.y, kind: p.kind, pageId: p.pageId, crosses: p.crosses };
  });

  const bounds = [0, ...cuts.map((c) => c.y), total];
  const slices: Slice[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const y = bounds[k]!;
    const height = bounds[k + 1]! - y;
    const isLast = k === bounds.length - 2;
    slices.push({ index: k, y, height, imageHeight: isLast ? height : Math.min(height + overlapPx, total - y), short: !isLast && height < minHeight });
  }

  const toCheck = new Set<string>();
  const broken = new Set<string>();
  for (const cut of cuts) {
    if (cut.kind === "gutter") continue;
    if (cut.pageId) toCheck.add(cut.pageId);
    for (const o of cut.crosses) if (o.kind === "balloon") broken.add(o.pageId);
  }
  const pages = strip.pageSpans.length;

  return {
    slices,
    cuts,
    report: {
      pages,
      pagesToCheck: [...toCheck],
      pagesWithBrokenBalloons: [...broken],
      checkRatio: pages === 0 ? 0 : toCheck.size / pages,
      shortSlices: slices.filter((s) => s.short).length,
    },
  };
}
