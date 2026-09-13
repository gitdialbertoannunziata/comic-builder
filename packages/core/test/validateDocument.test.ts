import { describe, expect, it } from "vitest";
import { validateDocument, hasErrors } from "../src/validate/validateDocument.js";
import { ep012p003 } from "../src/fixtures/ep012-p003.js";
import type { Page } from "../src/schema/page.js";

describe("validateDocument — griglia (§7.1)", () => {
  it("non produce errori sulla pagina a 6 pannelli valida", () => {
    const issues = validateDocument(ep012p003);
    expect(hasErrors(issues)).toBe(false);
  });

  it("segnala un buco quando un pannello viene rimosso senza aggiustare la griglia", () => {
    const broken = structuredClone(ep012p003);
    broken.panels = broken.panels.filter((p) => p.id !== "ep012-p003-05");
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.hole")).toBe(true);
  });

  it("segnala una sovrapposizione non dichiarata (z=0 su entrambi)", () => {
    const broken = structuredClone(ep012p003);
    // ep012-p003-04 (col:2,row:1) si sovrappone deliberatamente a ep012-p003-06 (col:1,row:2,span:2)
    broken.panels.find((p) => p.id === "ep012-p003-04")!.area = {
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
    const broken = structuredClone(ep012p003);
    const inset = broken.panels.find((p) => p.id === "ep012-p003-04")!;
    inset.area = { col: 1, row: 2, col_span: 1, row_span: 1, z: 1 };
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.overlap-undeclared")).toBe(false);
  });

  it("segnala uno span oltre i limiti delle tracce", () => {
    const broken = structuredClone(ep012p003);
    broken.panels[0]!.area = { col: 2, row: 0, col_span: 2, row_span: 1, z: 0 };
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "grid.span-out-of-bounds")).toBe(true);
  });
});

describe("validateDocument — reading_order (§5.4)", () => {
  it("segnala un id duplicato", () => {
    const broken = structuredClone(ep012p003) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order[5] = broken.layout.reading_order[0]!;
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.duplicate")).toBe(true);
  });

  it("segnala un id inesistente", () => {
    const broken = structuredClone(ep012p003) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order[0] = "non-esiste";
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.unknown-id")).toBe(true);
  });

  it("segnala un pannello mancante dall'ordine di lettura", () => {
    const broken = structuredClone(ep012p003) as Page;
    if (broken.layout.mode === "page") {
      broken.layout.reading_order.pop();
    }
    const issues = validateDocument(broken);
    expect(issues.some((i) => i.code === "order.incomplete")).toBe(true);
  });
});
