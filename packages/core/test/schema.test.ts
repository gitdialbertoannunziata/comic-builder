import { describe, expect, it } from "vitest";
import { PageSchema } from "../src/schema/page.js";
import { ProjectSchema, LetteringConfigSchema } from "../src/schema/project.js";
import { ScenesDocSchema } from "../src/schema/scenes.js";
import { ChaptersDocSchema } from "../src/schema/chapters.js";
import { samplePage } from "../src/fixtures/sample-page.js";

describe("PageSchema", () => {
  it("accetta la pagina a 6 pannelli scritta a mano", () => {
    const parsed = PageSchema.parse(samplePage);
    expect(parsed.panels).toHaveLength(6);
    expect(parsed.layout.mode).toBe("page");
  });

  it("rifiuta un'ancora di balloon fuori da [0,1]", () => {
    const broken = structuredClone(samplePage);
    broken.panels[2]!.balloons[0]!.anchor.x = 1.5;
    expect(() => PageSchema.parse(broken)).toThrow();
  });

  it("rifiuta un lens_mm fuori dal vocabolario chiuso", () => {
    const broken = structuredClone(samplePage) as unknown as { panels: Array<{ camera: { lens_mm: number } }> };
    broken.panels[0]!.camera.lens_mm = 50.5;
    expect(() => PageSchema.parse(broken)).toThrow();
  });
});

describe("ProjectSchema", () => {
  it("accetta un project.json minimale coerente con §5.2", () => {
    const project = ProjectSchema.parse({
      schema: 1,
      id: "sample-series",
      title: "Serie di prova",
      locale: "it-IT",
      text_direction: "ltr",
      reading_direction: "rtl",
      series_seed: 20250913,
      targets: [
        {
          id: "digital-page",
          kind: "page",
          size_px: [1600, 2400],
          color: "srgb",
          reading_direction: "rtl",
          primary: true,
        },
        {
          id: "webtoon-strip",
          kind: "strip",
          width_px: 1080,
          slice_max_h: 1280,
          seam: "none",
          format: "jpeg",
        },
        { id: "guided-view", kind: "regions", source: "digital-page" },
      ],
      page: { margin: { top: 56, right: 56, bottom: 56, left: 56 } },
      lettering: {
        font_family: "OpenComicSans",
        base_size_px: 26,
        line_height: 1.35,
        padding: 12,
        max_width_ratio: 0.62,
        tail_width: 10,
      },
      style: { preset: "ink-flat", positive: [], negative: [] },
      fonts: [
        { family: "OpenComicSans", path: "fonts/OpenComicSans.woff2", license: "OFL-1.1", scope: "dialogue" },
      ],
      chapters: "chapters.json",
      scenes: "scenes.json",
      app_version: "0.1.0",
      created: "2026-09-13T00:00:00Z",
    });

    expect(project.targets).toHaveLength(3);
    expect(project.targets[0]!.primary).toBe(true);
  });
});

describe("LetteringConfigSchema — safety_margin_ratio (§8.1)", () => {
  it("applica il default 0.15 se il progetto non lo specifica", () => {
    const lettering = LetteringConfigSchema.parse({
      font_family: "OpenComicSans",
      base_size_px: 26,
      line_height: 1.35,
      padding: 12,
      max_width_ratio: 0.62,
      tail_width: 10,
    });
    expect(lettering.safety_margin_ratio).toBe(0.15);
  });

  it("rispetta un valore esplicito diverso dal default", () => {
    const lettering = LetteringConfigSchema.parse({
      font_family: "OpenComicSans",
      base_size_px: 26,
      line_height: 1.35,
      padding: 12,
      max_width_ratio: 0.62,
      tail_width: 10,
      safety_margin_ratio: 0.3,
    });
    expect(lettering.safety_margin_ratio).toBe(0.3);
  });
});

describe("ScenesDocSchema / ChaptersDocSchema", () => {
  it("accetta scenes.json e chapters.json di esempio (§5.3)", () => {
    const scenes = ScenesDocSchema.parse({
      schema: 1,
      scenes: [
        {
          id: "scene-01",
          title: "Il garage",
          location: "garage di Alex",
          time_of_day: "sera",
          characters: ["alex"],
          beats: [
            { id: "scene-01-b1", function: "establish", summary: "Il garage vuoto, polvere controluce" },
            { id: "scene-01-b2", function: "reveal", summary: "Alex apre la porta e resta immobile" },
          ],
        },
      ],
    });
    expect(scenes.scenes[0]!.beats).toHaveLength(2);

    const chapters = ChaptersDocSchema.parse({
      schema: 1,
      chapters: [
        {
          id: "sample-chapter",
          number: 1,
          title: "Il garage",
          status: "in-production",
          due: "2026-10-02",
          pages: ["sample-page-01", "sample-page-02", "sample-page-03"],
        },
      ],
    });
    expect(chapters.chapters[0]!.pages).toHaveLength(3);
  });
});
