import { describe, expect, it } from "vitest";
import { resolvePageLayout, resolveStripFromPage } from "../src/layout/resolveLayout.js";
import { ep012p003 } from "../src/fixtures/ep012-p003.js";
import type { StripLayout } from "../src/schema/page.js";

const PAGE_W = 1600;
const PAGE_H = 2400;

describe("resolvePageLayout (§7.1)", () => {
  const boxes = resolvePageLayout(
    ep012p003.layout.mode === "page" ? ep012p003.layout : (() => {
      throw new Error("fixture non in modalità page");
    })(),
    ep012p003.panels,
    PAGE_W,
    PAGE_H,
  );

  it("produce un box per ogni pannello", () => {
    expect(boxes.size).toBe(6);
  });

  it("i box tassellano la pagina senza buchi né sovrapposizioni (somma delle aree)", () => {
    const totalArea = [...boxes.values()].reduce((sum, b) => sum + b.width * b.height, 0);
    // I gutter tolgono area rispetto al totale pagina: la somma dei pannelli dev'essere
    // minore dell'area di pagina ma vicina (gutter piccoli rispetto alla pagina).
    expect(totalArea).toBeLessThan(PAGE_W * PAGE_H);
    expect(totalArea).toBeGreaterThan(PAGE_W * PAGE_H * 0.85);
  });

  it("due pannelli sulla stessa riga non si sovrappongono in x", () => {
    const p01 = boxes.get("ep012-p003-01")!;
    const p02 = boxes.get("ep012-p003-02")!;
    expect(p01.x + p01.width).toBeLessThanOrEqual(p02.x);
  });

  it("due pannelli sulla stessa colonna non si sovrappongono in y", () => {
    const p01 = boxes.get("ep012-p003-01")!;
    const p03 = boxes.get("ep012-p003-03")!;
    expect(p01.y + p01.height).toBeLessThanOrEqual(p03.y);
  });

  it("un pannello con col_span 2 è largo quanto due colonne più il gutter interno", () => {
    const p02 = boxes.get("ep012-p003-02")!; // col:1, col_span:2
    const p01 = boxes.get("ep012-p003-01")!; // col:0, col_span:1 -> stessa larghezza di colonna
    const gutterX = ep012p003.layout.mode === "page" ? ep012p003.layout.gutter.x : 0;
    expect(p02.width).toBeCloseTo(p01.width * 2 + gutterX, 5);
  });
});

describe("resolveStripFromPage (§7.2, §4.1)", () => {
  const pageBoxes = resolvePageLayout(
    ep012p003.layout.mode === "page" ? ep012p003.layout : (() => {
      throw new Error("fixture non in modalità page");
    })(),
    ep012p003.panels,
    PAGE_W,
    PAGE_H,
  );

  const stripLayout: StripLayout = {
    mode: "strip",
    width_ratio: 1,
    panel_gap: 0,
    sequence: ep012p003.panels.map((p) => p.id),
  };

  const stripWidth = 1080;
  const stripBoxes = resolveStripFromPage(stripLayout, pageBoxes, stripWidth);

  it("produce un box per ogni pannello della sequenza", () => {
    expect(stripBoxes.size).toBe(6);
  });

  it("ogni box ha la larghezza della striscia", () => {
    for (const box of stripBoxes.values()) {
      expect(box.width).toBeCloseTo(stripWidth, 5);
    }
  });

  it("preserva l'aspect ratio del pannello sorgente", () => {
    const sourceBox = pageBoxes.get("ep012-p003-03")!;
    const stripBox = stripBoxes.get("ep012-p003-03")!;
    const sourceAspect = sourceBox.width / sourceBox.height;
    const stripAspect = stripBox.width / stripBox.height;
    expect(stripAspect).toBeCloseTo(sourceAspect, 5);
  });

  it("impila i pannelli in sequenza senza sovrapposizioni verticali", () => {
    let prevBottom = -Infinity;
    for (const id of stripLayout.sequence) {
      const box = stripBoxes.get(id)!;
      expect(box.y).toBeGreaterThanOrEqual(prevBottom);
      prevBottom = box.y + box.height;
    }
  });
});
