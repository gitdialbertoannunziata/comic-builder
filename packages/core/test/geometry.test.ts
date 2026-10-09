import { describe, expect, it } from "vitest";
import { samplePage } from "../src/fixtures/index.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { anchorFor, balloonBox, dragTrackBoundary, gutterHandles, neighbourPanel, tailPoint } from "../src/render/geometry.js";

const layout = samplePage.layout;
if (layout.mode !== "page") throw new Error();
const boxes = resolvePageLayout(layout, samplePage.panels, 1488, 2288, 56, 56);

describe("Geometria dei balloon: la stessa del renderer", () => {
  const panelBox = { x: 100, y: 200, width: 400, height: 300 };
  const fit = { balloonWidth: 120, balloonHeight: 60 };

  it("anchor è l'angolo in alto a sinistra, normalizzato al pannello", () => {
    expect(balloonBox({ anchor: { x: 0.25, y: 0.5 } }, panelBox, fit)).toEqual({ x: 200, y: 350, width: 120, height: 60 });
  });

  it("anchorFor è l'inverso di balloonBox", () => {
    const box = balloonBox({ anchor: { x: 0.3, y: 0.7 } }, panelBox, fit);
    const back = anchorFor(box.x, box.y, panelBox);
    expect(back.x).toBeCloseTo(0.3, 12);
    expect(back.y).toBeCloseTo(0.7, 12);
  });

  it("coda: target esplicito, oppure il ripiego corto sotto il balloon", () => {
    const box = { x: 200, y: 350, width: 120, height: 60 };
    expect(tailPoint({ tail: { mode: "manual", target: { x: 0.5, y: 1 } } }, panelBox, box)).toEqual({ x: 300, y: 500 });
    expect(tailPoint({ tail: { mode: "auto" } }, panelBox, box)).toEqual({ x: 260, y: 440 });
  });
});

describe("Maniglie dei gutter", () => {
  const handles = gutterHandles(samplePage, boxes);

  it("stanno nei gutter, mai sopra un pannello", () => {
    expect(handles.length).toBeGreaterThan(0);
    for (const h of handles) {
      for (const box of boxes.values()) {
        const inside =
          h.axis === "cols"
            ? h.x1 > box.x + 1 && h.x1 < box.x + box.width - 1 && Math.max(h.y1, box.y) < Math.min(h.y2, box.y + box.height) - 1
            : h.y1 > box.y + 1 && h.y1 < box.y + box.height - 1 && Math.max(h.x1, box.x) < Math.min(h.x2, box.x + box.width) - 1;
        expect(inside, `${h.axis}#${h.index} dentro un pannello`).toBe(false);
      }
    }
  });

  it("ogni confine fra righe ha una maniglia", () => {
    const rowBoundaries = new Set(handles.filter((h) => h.axis === "rows").map((h) => h.index));
    expect(rowBoundaries.size).toBe(layout.rows.length - 1);
  });
});

describe("Trascinare un confine fra tracce", () => {
  it("cambia solo le due tracce adiacenti, e la loro somma resta uguale", () => {
    const next = dragTrackBoundary([1, 2, 1], 0, 0, 600, 250, 20);
    expect(next[2]).toBe(1);
    expect(next[0]! + next[1]!).toBeCloseTo(3, 12);
    expect(next[0]! / 3).toBeCloseTo(240 / 600, 12);
  });

  it("non schiaccia una traccia sotto il minimo", () => {
    const next = dragTrackBoundary([1, 1], 0, 0, 600, 5, 20, 48);
    expect((next[0]! / 2) * 600).toBeCloseTo(48, 9);
    const other = dragTrackBoundary([1, 1], 0, 0, 600, 5000, 20, 48);
    expect((other[1]! / 2) * 600).toBeCloseTo(48, 9);
  });
});

describe("Il pannello accanto, per le frecce", () => {
  // Una fascia in alto, sotto una colonna alta a sinistra e due pannelli impilati a destra.
  const t = new Map([
    ["top", { x: 0, y: 0, width: 300, height: 100 }],
    ["tall", { x: 0, y: 110, width: 140, height: 200 }],
    ["r1", { x: 150, y: 110, width: 150, height: 95 }],
    ["r2", { x: 150, y: 215, width: 150, height: 95 }],
  ]);

  it("va al più vicino fra quelli di fronte", () => {
    expect(neighbourPanel(t, "r2", "left")).toBe("tall");
    expect(neighbourPanel(t, "r2", "up")).toBe("r1");
    expect(neighbourPanel(t, "r1", "up")).toBe("top");
    expect(neighbourPanel(t, "tall", "up")).toBe("top");
    expect(neighbourPanel(t, "r1", "down")).toBe("r2");
  });

  it("fra più pannelli di fronte alla stessa distanza sceglie il più allineato, poi il primo", () => {
    // Sotto la fascia ce ne sono due: quello di destra ha il centro più vicino al suo.
    expect(neighbourPanel(t, "top", "down")).toBe("r1");
    // A destra della colonna alta, due pannelli ugualmente allineati: il primo.
    expect(neighbourPanel(t, "tall", "right")).toBe("r1");
  });

  it("al bordo della pagina non c'è nessuno", () => {
    expect(neighbourPanel(t, "top", "up")).toBeNull();
    expect(neighbourPanel(t, "top", "left")).toBeNull();
    expect(neighbourPanel(t, "r2", "down")).toBeNull();
    expect(neighbourPanel(t, "r2", "right")).toBeNull();
    expect(neighbourPanel(t, "manca", "right")).toBeNull();
  });

  it("se di fronte non c'è nessuno, il più vicino in quella direzione", () => {
    const diagonal = new Map([
      ["a", { x: 0, y: 0, width: 50, height: 50 }],
      ["b", { x: 100, y: 100, width: 50, height: 50 }],
    ]);
    expect(neighbourPanel(diagonal, "a", "right")).toBe("b");
    expect(neighbourPanel(diagonal, "a", "down")).toBe("b");
    expect(neighbourPanel(diagonal, "b", "left")).toBe("a");
    expect(neighbourPanel(diagonal, "a", "left")).toBeNull();
  });

  it("sulla pagina d'esempio si torna da dove si è partiti", () => {
    for (const id of boxes.keys()) {
      for (const [there, back] of [["right", "left"], ["down", "up"]] as const) {
        const next = neighbourPanel(boxes, id, there);
        if (next) expect(neighbourPanel(boxes, next, back)).not.toBeNull();
      }
    }
  });
});
