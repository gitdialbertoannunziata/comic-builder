import { describe, expect, it } from "vitest";
import { rasterizeSvgToPng } from "../src/rasterize.js";
import {
  PageSchema,
  resolvePageLayout,
  renderPageSvg,
  BalloonStyleSchema,
  DraftStyleSchema,
  type RenderConfig,
} from "@comic-builder/core";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function plainSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="white"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="black" stroke-width="3"/></svg>`;
}

describe("rasterizeSvgToPng — meccanica di base", () => {
  it("produce un PNG valido (signature + dimensioni) alla dimensione naturale dell'SVG", () => {
    const png = rasterizeSvgToPng(plainSvg(400, 300));

    expect([...png.data.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(png.width).toBe(400);
    expect(png.height).toBe(300);
    expect(png.data.length).toBeGreaterThan(200);
  });

  it("ridimensiona con widthPx preservando il rapporto del viewBox", () => {
    const png = rasterizeSvgToPng(plainSvg(1600, 2400), { widthPx: 800 });

    expect(png.width).toBe(800);
    expect(png.height).toBe(1200);
  });

  it("accetta un background senza errori, su un SVG altrimenti trasparente", () => {
    const transparent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"></svg>`;
    const png = rasterizeSvgToPng(transparent, { background: "#ff0000" });
    expect(png.data.length).toBeGreaterThan(0);
  });
});

describe("rasterizeSvgToPng — pipeline reale del Core (§12: 'export SVG/PNG')", () => {
  it("rasterizza l'SVG prodotto da renderPageSvg per una pagina minima", () => {
    const page = PageSchema.parse({
      schema: 1,
      id: "export-test-page",
      chapter_id: "export-test",
      order: 1,
      layout: {
        mode: "page",
        primary_target: "digital-page",
        cols: [1],
        rows: [1],
        gutter: { x: 0, y: 0 },
        reading_order: ["p1"],
      },
      panels: [
        {
          id: "p1",
          scene_id: "s1",
          beat_index: 0,
          area: { col: 0, row: 0 },
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
          action: "pannello di prova",
          setting: "prova",
          art: { source: null, status: "missing" },
          seed: { mode: "auto", value: null, epoch: 0 },
        },
      ],
    });

    const width = 400;
    const height = 600;
    if (page.layout.mode !== "page") throw new Error("layout non in modalità page");
    const boxes = resolvePageLayout(page.layout, page.panels, width, height);
    const config: RenderConfig = {
      width,
      height,
      fontFamily: "sans-serif",
      lineHeight: 1.35,
      padding: 12,
      tailWidthPx: 10,
      balloonStyle: BalloonStyleSchema.parse({}),
      draftStyle: DraftStyleSchema.parse({}),
      baseFontSizePx: 26,
      target: "digital-page",
      // Senza font a disposizione in questo test non si può misurare il testo
      // dell'azione: il layer bozza resta spento, si verifica la sola rasterizzazione.
      draft: false,
    };
    const svg = renderPageSvg(page, boxes, new Map(), config);

    const png = rasterizeSvgToPng(svg);
    expect([...png.data.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(png.width).toBe(width);
    expect(png.height).toBe(height);
  });
});
