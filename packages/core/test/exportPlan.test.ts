import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { BalloonStyleSchema, DraftStyleSchema, LetteringConfigSchema } from "../src/schema/project.js";
import { finishTargetExport, planTargetExport, type ExportContext, type MeasureFits } from "../src/targets/exportPlan.js";
import type { LetteringFit } from "../src/render/types.js";

/**
 * Misura finta ma proporzionata: il balloon cresce col corpo del lettering,
 * come farebbe quella vera. Basta a verificare la pianificazione senza font.
 */
const measure: MeasureFits = ({ page, boxes, lettering }) => {
  const fits = new Map<string, LetteringFit>();
  for (const panel of page.panels) {
    if (!boxes.has(panel.id)) continue;
    for (const b of panel.balloons) {
      const size = lettering.base_size_px;
      fits.set(b.id, { lines: [[{ text: "x" }]], fontSizePx: size, blockHeight: size, balloonWidth: size * 8, balloonHeight: size * 3 });
    }
  }
  return fits;
};

const pages = buildPagesFromScene({
  scene: sampleScene,
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});

const ctx: ExportContext = {
  project: sampleProject,
  pages,
  chapter: { id: "ep001", number: 1, title: "Il faro" },
  styles: {
    lettering: LetteringConfigSchema.parse(sampleProject.lettering),
    balloonStyle: BalloonStyleSchema.parse({}),
    draftStyle: DraftStyleSchema.parse({}),
  },
  measure,
};

function rasterizeAll(jobs: { name: string }[]): Map<string, Uint8Array> {
  return new Map(jobs.map((j) => [j.name, Uint8Array.from([0xff, 0xd8, 1, 2])]));
}

describe("Criterio d'uscita F2.1: un episodio in più formati dallo stesso documento", () => {
  it("il capitolo d'esempio ha più pagine", () => {
    expect(pages.length).toBeGreaterThan(1);
  });

  it("pagina digitale: un PNG per pagina, nominato in ordine di lettura", () => {
    const plan = planTargetExport(ctx, "digital-page");
    expect(plan.jobs).toHaveLength(pages.length);
    expect(plan.jobs.map((j) => j.name)).toEqual([...plan.jobs.map((j) => j.name)].sort());
    expect(plan.jobs[0]!.name).toMatch(/^digital-page\/0*1-.*\.png$/);
    expect(plan.jobs.every((j) => j.width === 1600 && j.height === 2400)).toBe(true);
  });

  it("stampa: canvas col bleed, fondo pieno e scala di grigi nell'SVG", () => {
    const plan = planTargetExport(ctx, "print-b5");
    const job = plan.jobs[0]!;
    expect([job.width, job.height]).toEqual([4441, 6213]);
    expect(job.svg).toContain('feColorMatrix type="saturate" values="0"');
    expect(job.svg).toContain('fill="#ffffff"');
  });

  it("stampa: il lettering è in unità di pagina, quindi scala con il formato", () => {
    const sizes: number[] = [];
    const spy: MeasureFits = (input) => {
      sizes.push(input.lettering.base_size_px);
      return measure(input);
    };
    planTargetExport({ ...ctx, measure: spy }, "print-b5");
    expect(sizes[0]).toBeCloseTo(26 * (4299 / 1600), 6);
  });

  it("striscia: slice che coprono l'episodio, larghe 1080, entro il massimo", () => {
    const plan = planTargetExport(ctx, "webtoon-strip");
    expect(plan.jobs.length).toBeGreaterThan(1);
    for (const job of plan.jobs) {
      expect(job.width).toBe(1080);
      expect(job.height).toBeLessThanOrEqual(1280);
      expect(job.format).toBe("jpeg");
      expect(job.name).toMatch(/^webtoon-strip\/ep001-\d{3}\.jpg$/);
    }
    const covered = plan.slicePlan!.slices.reduce((n, s) => n + s.height, 0);
    expect(plan.slicePlan!.slices.at(-1)!.y + plan.slicePlan!.slices.at(-1)!.height).toBe(covered);
    // Ogni slice è una finestra sullo stesso disegno.
    expect(plan.jobs[1]!.svg).toMatch(/viewBox="0 \d+(\.\d+)? 1080 /);
    expect(plan.files[0]!.name).toBe("webtoon-strip/ep001-slicing.json");
  });

  it("striscia: nessun balloon tagliato sul capitolo d'esempio", () => {
    const plan = planTargetExport(ctx, "webtoon-strip");
    expect(plan.slicePlan!.report.pagesWithBrokenBalloons).toEqual([]);
    expect(plan.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("guided view: un file di regioni riferito alle immagini della pagina digitale", () => {
    const plan = planTargetExport(ctx, "guided-view");
    expect(plan.jobs).toEqual([]);
    const doc = JSON.parse(plan.files[0]!.data as string) as { pages: Array<{ image: string; regions: unknown[] }> };
    expect(doc.pages).toHaveLength(pages.length);
    expect(doc.pages[0]!.image).toMatch(/^digital-page\/0*1-.*\.png$/);
  });

  it("CBZ: le immagini della sorgente, alla radice dell'archivio, in un solo file", () => {
    const plan = planTargetExport(ctx, "cbz");
    expect(plan.archive?.info.readingDirection).toBe("ltr");
    expect(plan.jobs.every((j) => !j.name.includes("/"))).toBe(true);
    const { files } = finishTargetExport(plan, rasterizeAll(plan.jobs));
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("cbz/ep001.cbz");
    expect(files[0]!.mediaType).toBe("application/vnd.comicbook+zip");
  });

  it("i limiti di peso della piattaforma si controllano a immagini fatte", () => {
    const plan = planTargetExport(ctx, "webtoon-strip");
    const heavy = new Map(plan.jobs.map((j) => [j.name, new Uint8Array(3_000_000)]));
    const target = sampleProject.targets.find((t) => t.id === "webtoon-strip");
    const { issues } = finishTargetExport(plan, heavy, target);
    expect(issues.map((i) => i.code)).toContain("export.image-too-heavy");
    expect(issues.map((i) => i.code)).toContain("export.episode-too-heavy");
  });

  it("stesso documento, stesso piano", () => {
    expect(planTargetExport(ctx, "webtoon-strip")).toEqual(planTargetExport(ctx, "webtoon-strip"));
  });
});

describe("Striscia: tetto all'altezza del pannello", () => {
  it("nessun pannello supera panel_max_h (default: slice_max_h); chi lo supererebbe si centra", async () => {
    const { resolveEpisodeStrip } = await import("../src/targets/strip.js");
    const { resolvePageTargetGeometry } = await import("../src/targets/geometry.js");
    const strip = sampleProject.targets.find((t) => t.kind === "strip");
    const digital = sampleProject.targets.find((t) => t.id === "digital-page");
    if (strip?.kind !== "strip" || digital?.kind !== "page") throw new Error();
    const result = resolveEpisodeStrip(pages, strip, resolvePageTargetGeometry(digital, sampleProject));
    for (const { box } of result.placements) {
      expect(box.height).toBeLessThanOrEqual(1280 + 1e-6);
      expect(box.x + box.width / 2).toBeCloseTo(540, 6);
    }
    expect(result.placements.some((p) => p.box.width < 1080)).toBe(true);
  });

  it("il capitolo d'esempio passa il gate di F2.1: meno del 20% di pagine da ritoccare", () => {
    expect(planTargetExport(ctx, "webtoon-strip").slicePlan!.report.checkRatio).toBeLessThan(0.2);
  });
});

describe("Gate di F2.1 su un episodio vario (12 pagine, 5 template)", () => {
  it("meno del 20% di pagine con tagli da controllare, e nessun balloon tagliato", async () => {
    const { projectDocFrom } = await import("../src/document/projectDoc.js");
    const { applyCommand } = await import("../src/editor/commands.js");
    let doc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages });
    const templates = ["classic-6", "top-splash-3", "t-layout", "sidebar-2", "strip-4"];
    for (let i = 0; i < 10; i++) doc = applyCommand(doc, { type: "page.add", chapterId: "ep001", templateId: templates[i % 5]!, sceneId: sampleScene.id });
    const plan = planTargetExport({ ...ctx, pages: Object.values(doc.pages) }, "webtoon-strip").slicePlan!;
    expect(plan.report.pages).toBe(12);
    // Col minimo rigido era il 33%: un pannello basso fra due alti costringeva a tagliare l'arte.
    expect(plan.report.checkRatio).toBeLessThan(0.2);
    expect(plan.report.pagesWithBrokenBalloons).toEqual([]);
  });
});
