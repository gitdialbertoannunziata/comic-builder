import { describe, expect, it } from "vitest";
import { validateDocument, hasErrors } from "../src/validate/validateDocument.js";
import { samplePage } from "../src/fixtures/sample-page.js";
import type { Page } from "../src/schema/page.js";

describe("validateDocument — griglia (§7.1)", () => {
  it("non produce errori sulla pagina a 6 pannelli valida", () => {
    const issues = validateDocument(samplePage);
    expect(hasErrors(issues)).toBe(false);
  });

  it("segnala un buco quando un pannello viene rimosso senza aggiustare la griglia", () => {
    const broken = structuredClone(samplePage);
    broken.panels = broken.panels.filter((p) => p.id !== "sample-page-05");
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.hole")).toBe(true);
  });

  it("segnala una sovrapposizione non dichiarata (z=0 su entrambi)", () => {
    const broken = structuredClone(samplePage);
    // sample-page-04 (col:2,row:1) si sovrappone deliberatamente a sample-page-06 (col:1,row:2,span:2)
    broken.panels.find((p) => p.id === "sample-page-04")!.area = {
      col: 1,
      row: 2,
      col_span: 1,
      row_span: 1,
      z: 0,
    };
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.overlap-undeclared")).toBe(true);
  });

  it("ammette una sovrapposizione con z esplicito diverso (inset dichiarato)", () => {
    const broken = structuredClone(samplePage);
    const inset = broken.panels.find((p) => p.id === "sample-page-04")!;
    inset.area = { col: 1, row: 2, col_span: 1, row_span: 1, z: 1 };
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.overlap-undeclared")).toBe(false);
  });

  it("segnala uno span oltre i limiti delle tracce", () => {
    const broken = structuredClone(samplePage);
    broken.panels[0]!.area = { col: 2, row: 0, col_span: 2, row_span: 1, z: 0 };
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.span-out-of-bounds")).toBe(true);
  });
});

describe("validateDocument — reading_order (§5.4)", () => {
  it("segnala un id duplicato", () => {
    const broken = structuredClone(samplePage) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order[5] = broken.layout.reading_order[0]!;
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.duplicate")).toBe(true);
  });

  it("segnala un id inesistente", () => {
    const broken = structuredClone(samplePage) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order[0] = "non-esiste";
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.unknown-id")).toBe(true);
  });

  it("segnala un pannello mancante dall'ordine di lettura", () => {
    const broken = structuredClone(samplePage) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order.pop();
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.incomplete")).toBe(true);
  });
});
