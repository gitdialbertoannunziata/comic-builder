import { describe, expect, it } from "vitest";
import { PAGE_TEMPLATES, getTemplate } from "../src/templates/catalog.js";
import { expandTemplate } from "../src/templates/expand.js";
import { validateDocument, hasErrors } from "../src/validate/validateDocument.js";
import { PageSchema, type Page } from "../src/schema/page.js";
import type { PageTemplate } from "../src/templates/catalog.js";
import type { ReadingDirection } from "../src/schema/common.js";

/** Costruisce una pagina minima da un template, per passarla a validateDocument. */
function pageFromTemplate(template: PageTemplate, direction: ReadingDirection): Page {
  const panelIds = template.areas.map((_, i) => `p${i + 1}`);
  const { layout, areas } = expandTemplate(template, panelIds, {
    primaryTarget: "digital-page",
    gutter: { x: 14, y: 18 },
    readingDirection: direction,
  });

  return PageSchema.parse({
    schema: 1,
    id: "t-page",
    chapter_id: "t-chapter",
    order: 1,
    layout,
    panels: areas.map((area, i) => ({
      id: panelIds[i],
      scene_id: "s",
      beat_index: i,
      area,
      border: { style: "solid", width: 3 },
      camera: {
        shot: "MS",
        angle: "eye",
        lens_mm: 35,
        dof: "deep",
        lighting: "flat",
        mood: "calm",
        motion: "static",
        subject_placement: "center",
        axis_side: "A-left",
      },
      action: "",
      setting: "",
      art: { source: null, status: "missing" },
      seed: { mode: "auto", value: null, epoch: 0 },
    })),
  });
}

describe("Catalogo template (Appendice B)", () => {
  it("contiene gli otto template dichiarati dal piano", () => {
    expect(PAGE_TEMPLATES.map((t) => t.id).sort()).toEqual(
      [
        "classic-6",
        "grid-3x3",
        "nine-grid-dialogue",
        "sidebar-2",
        "splash",
        "strip-4",
        "t-layout",
        "top-splash-3",
      ].sort(),
    );
  });

  // L'invariante dichiarata dall'Appendice B: "Le aree di un template tassellano
  // sempre la griglia: un template non valido non entra nel catalogo".
  it.each(PAGE_TEMPLATES.map((t) => [t.id, t] as const))("«%s» tassella la griglia (ltr)", (_id, template) => {
    const issues = validateDocument(pageFromTemplate(template, "ltr"));
    expect(issues).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it.each(PAGE_TEMPLATES.map((t) => [t.id, t] as const))("«%s» tassella anche specchiato (rtl)", (_id, template) => {
    const issues = validateDocument(pageFromTemplate(template, "rtl"));
    expect(issues).toEqual([]);
  });

  it("ogni template dichiara un uso, che serve all'editor e al prompt del modello", () => {
    for (const template of PAGE_TEMPLATES) {
      expect(template.usage.length).toBeGreaterThan(0);
    }
  });
});

describe("expandTemplate — reading_direction (§5.2)", () => {
  it("specchia le colonne in rtl, lasciando invariato l'ordine di lettura", () => {
    const template = getTemplate("classic-6")!;
    const panelIds = template.areas.map((_, i) => `p${i + 1}`);
    const options = { primaryTarget: "digital-page", gutter: { x: 0, y: 0 } };

    const ltr = expandTemplate(template, panelIds, { ...options, readingDirection: "ltr" });
    const rtl = expandTemplate(template, panelIds, { ...options, readingDirection: "rtl" });

    expect(ltr.layout.reading_order).toEqual(rtl.layout.reading_order);

    // classic-6 apre con un pannello stretto: a sinistra in ltr, a destra in rtl.
    expect(ltr.areas[0]).toMatchObject({ col: 0, col_span: 1 });
    expect(rtl.areas[0]).toMatchObject({ col: 2, col_span: 1 });

    // La seconda area (2/3 di riga) è l'immagine speculare della prima.
    expect(ltr.areas[1]).toMatchObject({ col: 1, col_span: 2 });
    expect(rtl.areas[1]).toMatchObject({ col: 0, col_span: 2 });
  });

  it("specchiare due volte riporta al lay-out di partenza", () => {
    const template = getTemplate("t-layout")!;
    const panelIds = template.areas.map((_, i) => `p${i + 1}`);
    const options = { primaryTarget: "digital-page", gutter: { x: 0, y: 0 } };

    const rtl = expandTemplate(template, panelIds, { ...options, readingDirection: "rtl" });
    const mirroredTwice = expandTemplate(
      { ...template, areas: rtl.areas },
      panelIds,
      { ...options, readingDirection: "rtl" },
    );

    expect(mirroredTwice.areas).toEqual(template.areas);
  });

  it("rifiuta un numero di id diverso dal numero di aree", () => {
    const template = getTemplate("classic-6")!;
    expect(() =>
      expandTemplate(template, ["solo-uno"], {
        primaryTarget: "digital-page",
        gutter: { x: 0, y: 0 },
        readingDirection: "ltr",
      }),
    ).toThrow(/6 aree/);
  });
});
