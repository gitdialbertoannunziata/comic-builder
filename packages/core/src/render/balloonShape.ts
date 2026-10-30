import type { Balloon, BalloonShape, BalloonType, Tail } from "../schema/balloon.js";
import type { Box } from "../layout/resolveLayout.js";

/**
 * Le forme dei balloon come geometria pura: tracciati SVG costruiti dal box
 * del balloon. Stanno nel Core e non nel renderer perché due pacchetti ne
 * devono sapere la stessa cosa: il lettering (quanto spazio lascia la forma
 * al testo) e il renderer (cosa si disegna).
 */

interface Point {
  x: number;
  y: number;
}

/** La forma con cui si disegna: quella scelta, o quella di sempre per il tipo. */
export function balloonShape(balloon: Pick<Balloon, "type" | "shape">): BalloonShape {
  return balloon.shape ?? (balloon.type === "sfx" ? "none" : "rounded");
}

/**
 * La forma convenzionale di un tipo di battuta, per i balloon che nascono
 * dallo spoglio: il modello sceglie il tipo, e la forma ne segue come in un
 * fumetto disegnato a mano. Parlato e sussurro restano sul classico (il
 * sussurro si distingue già dal tratteggio dello stile).
 */
export function conventionalShape(type: BalloonType): { shape?: BalloonShape; bubbles?: boolean } {
  switch (type) {
    case "thought":
      return { shape: "cloud", bubbles: true };
    case "shout":
      return { shape: "burst" };
    case "caption":
      return { shape: "rect" };
    case "offpanel":
      return { shape: "spiky" };
    default:
      return {};
  }
}

/**
 * Quanto il box della forma dev'essere più grande del blocco di testo (padding
 * compreso), per asse. Un rettangolo contiene il testo fin sui bordi; un'ellisse
 * no, e una nuvola o un'esplosione hanno il bordo interno ancora più dentro.
 */
export function shapeTextScale(shape: BalloonShape): { x: number; y: number } {
  switch (shape) {
    case "ellipse":
      return { x: 1.28, y: 1.32 };
    case "cloud":
      return { x: 1.42, y: 1.5 };
    case "burst":
      return { x: 1.6, y: 1.75 };
    case "spiky":
    case "wavy":
      return { x: 1.34, y: 1.38 };
    default:
      return { x: 1, y: 1 };
  }
}

/** Una forma con contorno ellittico: la coda parte dall'interno dell'ellisse inscritta. */
function isRoundish(shape: BalloonShape): boolean {
  return shape !== "rounded" && shape !== "rect" && shape !== "none";
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function onEllipse(c: Point, rx: number, ry: number, angle: number, scale = 1): Point {
  return { x: c.x + rx * scale * Math.cos(angle), y: c.y + ry * scale * Math.sin(angle) };
}

/** Perimetro approssimato (Ramanujan): decide quante gobbe o punte ha la forma, così una forma grande non ha gobbe enormi. */
function perimeter(rx: number, ry: number): number {
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

function count(rx: number, ry: number, spacing: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(perimeter(rx, ry) / Math.max(1, spacing))));
}

/**
 * `n` angoli (parametrici) equidistanti lungo il contorno dell'ellisse, a
 * partire dall'alto. Ad angoli equidistanti, su un balloon largo le gobbe si
 * affollerebbero ai lati e si allargherebbero sopra e sotto.
 */
function evenAngles(rx: number, ry: number, n: number): number[] {
  const samples = 360;
  const start = -Math.PI / 2;
  const lengths = [0];
  for (let i = 1; i <= samples; i++) {
    const t = start + (i / samples) * Math.PI * 2;
    lengths.push(lengths[i - 1]! + Math.hypot(rx * Math.sin(t), ry * Math.cos(t)) * ((Math.PI * 2) / samples));
  }
  const total = lengths[samples]!;
  const angles: number[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const goal = (k / n) * total;
    while (j < samples && lengths[j + 1]! < goal) j++;
    const span = lengths[j + 1]! - lengths[j]! || 1;
    angles.push(start + ((j + (goal - lengths[j]!) / span) / samples) * Math.PI * 2);
  }
  return angles;
}

/** Il punto del contorno all'angolo `t`, rientrato verso il centro di `depth` px: punte e gobbe profonde uguali tutto attorno. */
function insetPoint(c: Point, rx: number, ry: number, t: number, depth: number): Point {
  const p = onEllipse(c, rx, ry, t);
  const r = Math.hypot(p.x - c.x, p.y - c.y) || 1;
  return onEllipse(c, rx, ry, t, Math.max(0.2, 1 - depth / r));
}

/**
 * Il tracciato del contorno, per le forme che non sono un `<rect>`. Tutto è
 * deterministico: la stessa pagina rende sempre lo stesso SVG (i test golden
 * e la cache dell'export ci contano).
 */
export function shapePath(shape: BalloonShape, box: Box): string | null {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const rx = box.width / 2;
  const ry = box.height / 2;
  const small = Math.min(box.width, box.height);

  switch (shape) {
    case "cloud": {
      // Archi fra punti di un'ellisse più interna: ogni arco è una gobba verso fuori.
      const n = count(rx, ry, small * 0.42, 8, 26);
      const pts = evenAngles(rx, ry, n).map((t) => insetPoint(c, rx, ry, t, small * 0.12));
      let d = `M${r2(pts[0]!.x)},${r2(pts[0]!.y)}`;
      for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const radius = Math.hypot(b.x - a.x, b.y - a.y) * 0.56;
        d += ` A${r2(radius)},${r2(radius)} 0 0 1 ${r2(b.x)},${r2(b.y)}`;
      }
      return d + "Z";
    }
    case "burst":
    case "spiky": {
      // Punte alternate fra il bordo e un'ellisse interna; per l'esplosione le
      // punte non sono tutte uguali, come in un urlo disegnato a mano.
      const burst = shape === "burst";
      const n = burst ? count(rx, ry, small * 0.36, 10, 28) : count(rx, ry, small * 0.13, 18, 72);
      const depth = small * (burst ? 0.24 : 0.07);
      const jitter = [0, 0.35, 0.1, 0.5, 0, 0.25];
      let d = "";
      evenAngles(rx, ry, n * 2).forEach((t, i) => {
        // Le punte stanno sul bordo (un po' rientrate a caso, per l'urlo); le valli rientrano di `depth`.
        const inset = i % 2 === 1 ? depth : burst ? depth * jitter[(i / 2) % jitter.length]! : 0;
        const p = insetPoint(c, rx, ry, t, inset);
        d += `${i === 0 ? "M" : " L"}${r2(p.x)},${r2(p.y)}`;
      });
      return d + "Z";
    }
    case "wavy": {
      // Un'ellisse che ondeggia: la voce che trema.
      const waves = count(rx, ry, small * 0.3, 10, 40);
      const amplitude = small * 0.035;
      let d = "";
      evenAngles(rx, ry, waves * 8).forEach((t, i) => {
        const p = insetPoint(c, rx, ry, t, amplitude * (1 + Math.sin((i / 8) * Math.PI * 2)));
        d += `${i === 0 ? "M" : " L"}${r2(p.x)},${r2(p.y)}`;
      });
      return d + "Z";
    }
    default:
      return null;
  }
}

/** Ruota `p` di `degrees` attorno a `center`. */
export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  if (!degrees) return p;
  const a = (degrees * Math.PI) / 180;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * Math.cos(a) - dy * Math.sin(a), y: center.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

export interface TailGeometry {
  /** Il tracciato della coda (vuoto per la scia di pallini). */
  path: string;
  /** Pallini della scia, dal più grande al più piccolo. */
  bubbles: Array<{ cx: number; cy: number; r: number }>;
}

/** Punto della quadratica a, ctrl, b al parametro t. */
function quad(a: Point, ctrl: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y };
}

/**
 * La coda nella sua forma completa: base dentro il contorno (così la forma la
 * copre e la giunzione non si vede), larghezza e curvatura dal documento, o
 * una scia di pallini per i pensieri. `box` e `target` sono nello stesso
 * sistema di riferimento, quello del balloon non ruotato.
 */
export function tailGeometry(shape: BalloonShape, box: Box, target: Point, tail: Pick<Tail, "width" | "curve" | "bubbles">, baseWidthPx: number): TailGeometry {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const rx = box.width / 2;
  const ry = box.height / 2;
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const angle = dx === 0 && dy === 0 ? Math.PI / 2 : Math.atan2(dy / ry, dx / rx);
  const halfWidth = (baseWidthPx * (tail.width ?? 1)) / 2;

  if (tail.bubbles) {
    // La scia parte appena fuori dal contorno e scende verso chi pensa.
    const start = onEllipse(c, rx, ry, angle, isRoundish(shape) ? 1.02 : 1.08);
    const len = Math.hypot(target.x - start.x, target.y - start.y) || 1;
    const ctrl = curveControl(start, target, tail.curve ?? 0);
    // Pallini proporzionati al balloon, non alla coda: il primo è una piccola nuvola, l'ultimo un puntino.
    const base = Math.min(Math.min(box.width, box.height) * 0.2 * (tail.width ?? 1), len / 5);
    const bubbles = [0.2, 0.52, 0.82].map((t, i) => {
      const p = quad(start, ctrl, target, t);
      return { cx: r2(p.x), cy: r2(p.y), r: r2(Math.max(1.5, base * [1, 0.66, 0.4][i]!)) };
    });
    return { path: "", bubbles };
  }

  // Base all'interno: per una forma squadrata basta l'ellisse inscritta, per
  // una tonda si rientra fino a stare sotto le gobbe o fra le punte.
  const edge = onEllipse(c, rx, ry, angle, isRoundish(shape) ? 0.62 : 0.85);
  const len = Math.hypot(target.x - edge.x, target.y - edge.y) || 1;
  const nx = -(target.y - edge.y) / len;
  const ny = (target.x - edge.x) / len;
  const b1 = { x: edge.x + nx * halfWidth, y: edge.y + ny * halfWidth };
  const b2 = { x: edge.x - nx * halfWidth, y: edge.y - ny * halfWidth };
  const curve = tail.curve ?? 0;
  if (!curve) {
    return { path: `M${r2(b1.x)},${r2(b1.y)} L${r2(target.x)},${r2(target.y)} L${r2(b2.x)},${r2(b2.y)}Z`, bubbles: [] };
  }
  const ctrl = curveControl(edge, target, curve);
  // I due fianchi curvano insieme, scostati di mezza base: la coda si assottiglia piegando.
  const c1 = { x: ctrl.x + nx * halfWidth * 0.5, y: ctrl.y + ny * halfWidth * 0.5 };
  const c2 = { x: ctrl.x - nx * halfWidth * 0.5, y: ctrl.y - ny * halfWidth * 0.5 };
  return {
    path: `M${r2(b1.x)},${r2(b1.y)} Q${r2(c1.x)},${r2(c1.y)} ${r2(target.x)},${r2(target.y)} Q${r2(c2.x)},${r2(c2.y)} ${r2(b2.x)},${r2(b2.y)}Z`,
    bubbles: [],
  };
}

/** Il punto di controllo di una coda curva: spostato di lato rispetto al punto medio, in proporzione alla lunghezza. */
function curveControl(from: Point, to: Point, curve: number): Point {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  return { x: (from.x + to.x) / 2 + nx * curve * len * 0.45, y: (from.y + to.y) / 2 + ny * curve * len * 0.45 };
}
