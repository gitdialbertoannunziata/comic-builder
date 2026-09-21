import { describe, expect, it } from "vitest";
import {
  BalloonStyleSchema,
  DraftStyleSchema,
  LetteringConfigSchema,
  ProjectSchema,
  buildPagesFromScene,
  planTargetExport,
  type ExportContext,
} from "@comic-builder/core";
import { sampleProject, sampleScene } from "@comic-builder/core/fixtures";
import { measureWith } from "@comic-builder/lettering";
import { loadSampleFont, sampleFontPath } from "@comic-builder/lettering/sampleFont";
import { rasterizeSvgToPixels, rasterizeSvgToPng } from "../src/rasterize.js";

/**
 * Lo slicing verificato con pixel veri (§7.2: "immagini golden"): le slice,
 * rimesse una sotto l'altra, devono ridare esattamente la striscia intera.
 * È la definizione operativa di "seam nullo" — nessuna riga bianca, nessun
 * pixel spostato alla giunzione.
 */
const pages = buildPagesFromScene({
  scene: sampleScene,
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});

function context(project = sampleProject): ExportContext {
  return {
    project,
    pages,
    chapter: { id: "ep001" },
    styles: {
      lettering: LetteringConfigSchema.parse(project.lettering),
      balloonStyle: BalloonStyleSchema.parse({}),
      draftStyle: DraftStyleSchema.parse({}),
    },
    measure: measureWith(loadSampleFont()),
    // Con la bozza accesa ogni pannello ha contenuto: una giunzione sbagliata si vede.
    draft: true,
  };
}

/** Lo stesso progetto con una slice sola, alta quanto l'episodio: la striscia intera. Il tetto dei pannelli resta quello di prima, o cambierebbe il lay-out. */
function wholeStrip() {
  return ProjectSchema.parse({
    ...sampleProject,
    targets: sampleProject.targets.map((t) =>
      t.kind === "strip" ? { ...t, panel_max_h: t.slice_max_h, slice_max_h: 1_000_000, slice_min_h: 1, limits: {} } : t,
    ),
  });
}

const fonts = { fontFiles: [sampleFontPath] };

describe("Striscia: le slice ricompongono la striscia intera, pixel per pixel", () => {
  it("nessuna differenza alle giunzioni", () => {
    const sliced = planTargetExport(context(), "webtoon-strip");
    const whole = planTargetExport(context(wholeStrip()), "webtoon-strip");
    expect(whole.jobs).toHaveLength(1);
    expect(sliced.jobs.length).toBeGreaterThan(1);

    const full = rasterizeSvgToPixels(whole.jobs[0]!.svg, fonts);
    const rowBytes = full.width * 4;

    let offset = 0;
    for (const job of sliced.jobs) {
      const part = rasterizeSvgToPixels(job.svg, fonts);
      expect(part.width).toBe(full.width);
      expect(part.height).toBe(job.height);
      const expected = full.data.subarray(offset * rowBytes, (offset + part.height) * rowBytes);
      // Confronto per righe, per un messaggio che dica *dove* diverge.
      for (let row = 0; row < part.height; row++) {
        const a = part.data.subarray(row * rowBytes, (row + 1) * rowBytes);
        const b = expected.subarray(row * rowBytes, (row + 1) * rowBytes);
        if (!a.every((v, i) => v === b[i])) {
          throw new Error(`${job.name}: la riga ${row} (y=${offset + row} nella striscia) differisce`);
        }
      }
      offset += part.height;
    }
    expect(offset).toBe(full.height);
  });

  it("nessun balloon tagliato con il lettering misurato davvero", () => {
    const plan = planTargetExport(context(), "webtoon-strip");
    expect(plan.slicePlan!.report.pagesWithBrokenBalloons).toEqual([]);
  });
});

describe("Stampa: la tavola esce alla risoluzione dichiarata", () => {
  it("B5 a 600 dpi con bleed, in PNG", () => {
    const plan = planTargetExport({ ...context(), draft: false }, "print-b5");
    const png = rasterizeSvgToPng(plan.jobs[0]!.svg, fonts);
    expect([png.width, png.height]).toEqual([4441, 6213]);
  });

  it("in scala di grigi: nessun pixel colorato", () => {
    const plan = planTargetExport(context(), "print-b5");
    // Mezza risoluzione basta a verificare il colore e dimezza il tempo del test.
    const img = rasterizeSvgToPixels(plan.jobs[0]!.svg, { ...fonts, widthPx: 1100 });
    for (let i = 0; i < img.data.length; i += 4) {
      const [r, g, b] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      if (Math.max(Math.abs(r - g), Math.abs(g - b)) > 1) throw new Error(`pixel ${i / 4} colorato: ${r},${g},${b}`);
    }
  });
});
