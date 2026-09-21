import { describe, expect, it } from "vitest";
import {
  BalloonStyleSchema,
  DraftStyleSchema,
  LetteringConfigSchema,
  SceneSchema,
  applyCommand,
  buildPagesFromScene,
  projectDocFrom,
  resolvePageBoxesForTarget,
  resolvePageTargetGeometry,
  type Page,
  type PageTarget,
} from "@comic-builder/core";
import { sampleProject } from "@comic-builder/core/fixtures";
import { computePageFits } from "../src/pageFits.js";
import { fitCacheStats, resetFitCache } from "../src/fitCache.js";
import { loadSampleFont } from "../src/sampleFont.js";

const font = loadSampleFont();
const lettering = LetteringConfigSchema.parse(sampleProject.lettering);
const draftStyle = DraftStyleSchema.parse({});
BalloonStyleSchema.parse({});
const target = sampleProject.targets.find((t) => t.id === "digital-page") as PageTarget;
const geometry = resolvePageTargetGeometry(target, sampleProject);

/** Un episodio vero per dimensione: 120 beat di dialogo, circa venti pagine. */
const LINES = ["Non c'è più niente qui dentro.", "Dalle due. Ho provato di tutto.", "Guarda qui: il quadro è annerito.", "Qualcuno aveva le chiavi."];
const scene = SceneSchema.parse({
  id: "s001",
  title: "Episodio",
  location: "faro",
  time_of_day: "notte",
  characters: ["sara", "elio"],
  beats: Array.from({ length: 120 }, (_, i) => ({
    id: `s001-b${i + 1}`,
    function: i % 5 === 0 ? "establish" : "dialogue",
    summary: `Beat ${i + 1}: Sara ed Elio discutono vicino alla lanterna spenta.`,
    lines: i % 5 === 0 ? [] : [
      { speaker: "sara", text: `${LINES[i % 4]} (${i})` },
      { speaker: "elio", text: `${LINES[(i + 1) % 4]} [${i}]` },
    ],
  })),
});
const pages = buildPagesFromScene({ scene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });

function reletter(list: readonly Page[]) {
  for (const page of list) {
    const boxes = resolvePageBoxesForTarget(page, geometry);
    computePageFits({ page, boxes, font, lettering, draftStyle, target: "digital-page", draft: true });
  }
}

describe("Re-lettering selettivo (§10.1 passo 4, §8.5)", () => {
  it("l'episodio di prova ha la dimensione di un episodio vero", () => {
    expect(pages.length).toBeGreaterThanOrEqual(18);
    expect(pages.flatMap((p) => p.panels.flatMap((x) => x.balloons)).length).toBeGreaterThanOrEqual(150);
  });

  it("riletterare un episodio di 20 pagine da zero: sotto i 2 secondi (§8.5)", () => {
    resetFitCache(font);
    const t0 = performance.now();
    reletter(pages);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
  });

  it("dopo una correzione si rimisura solo la battuta cambiata", () => {
    resetFitCache(font);
    reletter(pages);
    const cold = fitCacheStats(font);

    let doc = projectDocFrom({ project: sampleProject, scenes: [scene], chapter: { id: "ep001", number: 1, title: "t" }, pages });
    const target = pages[3]!.panels.find((p) => p.balloons.length > 0)!.balloons[0]!;
    doc = applyCommand(doc, { type: "balloon.text", pageId: pages[3]!.id, balloonId: target.id, text: [{ t: "Una battuta riscritta dallo sceneggiatore." }] });

    reletter(doc.chapters.chapters[0]!.pages.map((id) => doc.pages[id]!));
    const warm = fitCacheStats(font);
    expect(warm.misses - cold.misses).toBe(1);
    // Stesse chiamate del primo giro: tutte riusate tranne quella cambiata.
    expect(warm.hits - cold.hits).toBe(cold.misses + cold.hits - 1);
  });
});
