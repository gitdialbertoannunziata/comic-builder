import { describe, expect, it } from "vitest";
import { samplePage } from "../src/fixtures/index.js";
import type { Panel } from "../src/schema/panel.js";
import type { EpisodeStrip, Obstacle } from "../src/targets/strip.js";
import { stripObstacles } from "../src/targets/strip.js";
import { sliceStrip, type SlicePlan } from "../src/targets/slice.js";
import type { LetteringFit } from "../src/render/types.js";

const POLICY = { maxHeight: 1280, minHeight: 640, overlapPx: 0 };
const blank: Panel = { ...samplePage.panels[0]!, balloons: [], slice_avoid: [] };

/** Striscia sintetica: una lista di pagine, ognuna lista di altezze di pannello. */
function strip(pages: number[][], gap = 0): EpisodeStrip {
  const placements: EpisodeStrip["placements"] = [];
  const pageSpans: EpisodeStrip["pageSpans"] = [];
  let y = 0;
  pages.forEach((heights, p) => {
    const top = y;
    heights.forEach((h, i) => {
      if (i > 0) y += gap;
      placements.push({ pageId: `p${p + 1}`, panel: { ...blank, id: `p${p + 1}-${i + 1}` }, box: { x: 0, y, width: 1080, height: h } });
      y += h;
    });
    pageSpans.push({ pageId: `p${p + 1}`, y: top, height: y - top });
  });
  return { targetId: "strip", width: 1080, height: y, placements, pageSpans, letteringScale: 1 };
}

function balloon(y: number, height: number, pageId = "p1", id = "b"): Obstacle {
  return { y, height, kind: "balloon", pageId, id };
}

/** Invarianti che valgono per qualunque piano: copertura esatta, altezze nei limiti. */
function expectValid(plan: SlicePlan, s: EpisodeStrip, options: { allowShort?: boolean } = {}) {
  const total = Math.round(s.height);
  expect(plan.slices[0]!.y).toBe(0);
  let y = 0;
  plan.slices.forEach((slice, i) => {
    expect(slice.y).toBe(y);
    expect(slice.height).toBeLessThanOrEqual(POLICY.maxHeight);
    if (i < plan.slices.length - 1 && !options.allowShort) expect(slice.height).toBeGreaterThanOrEqual(POLICY.minHeight);
    expect(slice.short).toBe(i < plan.slices.length - 1 && slice.height < POLICY.minHeight);
    y += slice.height;
  });
  expect(y).toBe(total);
}

describe("sliceStrip — tagli nei gutter (§7.2)", () => {
  it("con pannelli che stanno in una slice, taglia solo ai bordi dei pannelli", () => {
    const s = strip([[700, 500, 900], [800, 400]]);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.every((c) => c.kind === "gutter")).toBe(true);
    expect(plan.report.checkRatio).toBe(0);
  });

  it("con un gutter visibile, taglia dentro lo spazio vuoto", () => {
    const s = strip([[700, 700, 700]], 40);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.every((c) => c.kind === "gutter")).toBe(true);
  });

  it("a parità di qualità preferisce meno immagini", () => {
    const s = strip([[600, 600, 600, 600]]);
    const plan = sliceStrip(s, [], POLICY);
    expect(plan.slices).toHaveLength(2); // 1200 + 1200, non quattro da 600
  });
});

describe("sliceStrip — casi limite chiesti dal piano (§7.2)", () => {
  it("un pannello basso fra due alti: una slice corta, non un taglio nell'arte", () => {
    // 545 da solo è sotto il minimo; con un vicino supera il massimo.
    const s = strip([[1280, 545, 1280]]);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s, { allowShort: true });
    expect(plan.cuts.every((c) => c.kind === "gutter")).toBe(true);
    expect(plan.report.shortSlices).toBe(1);
    expect(plan.slices.find((x) => x.short)?.height).toBe(545);
  });

  it("pannello più alto di una slice: taglia dentro, e lo segnala da controllare", () => {
    const s = strip([[3000]]);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.length).toBeGreaterThanOrEqual(2);
    expect(plan.cuts.every((c) => c.kind === "panel")).toBe(true);
    expect(plan.report.pagesToCheck).toEqual(["p1"]);
  });

  it("pannelli più bassi di min_height: li raggruppa invece di fare slice troppo basse", () => {
    const s = strip([[200, 200, 200, 200, 200, 200, 200, 200]]);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.every((c) => c.kind === "gutter")).toBe(true);
  });

  it("pagina con un solo pannello più basso di una slice: un'immagine sola", () => {
    const s = strip([[900]]);
    const plan = sliceStrip(s, [], POLICY);
    expect(plan.slices).toEqual([{ index: 0, y: 0, height: 900, imageHeight: 900, short: false }]);
    expect(plan.cuts).toEqual([]);
  });

  it("l'ultima slice dell'episodio può essere più bassa del minimo", () => {
    const s = strip([[1200, 100]]);
    const plan = sliceStrip(s, [], POLICY);
    expectValid(plan, s);
    expect(plan.slices.at(-1)!.height).toBe(100);
  });
});

describe("sliceStrip — mai a metà di un balloon (§7.2, §8.5)", () => {
  it("dentro un pannello alto, il taglio aggira i balloon", () => {
    const s = strip([[2400]]);
    // Balloon piazzati dove cadrebbero i tagli "naturali" a 1200 e 1280.
    const obstacles = [balloon(1100, 250), balloon(600, 120)];
    const plan = sliceStrip(s, obstacles, POLICY);
    expectValid(plan, s);
    for (const cut of plan.cuts) {
      for (const o of obstacles) expect(cut.y <= o.y || cut.y >= o.y + o.height).toBe(true);
    }
    expect(plan.report.pagesWithBrokenBalloons).toEqual([]);
  });

  it("un balloon a cavallo di un gutter sposta il taglio altrove", () => {
    const s = strip([[1000, 1000, 600]]);
    const plan = sliceStrip(s, [balloon(950, 100)], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.some((c) => c.y > 950 && c.y < 1050)).toBe(false);
  });

  it("un balloon più alto di una slice è l'unico caso in cui si attraversa, e diventa un errore", () => {
    const s = strip([[3000]]);
    const plan = sliceStrip(s, [balloon(100, 2800)], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.some((c) => c.kind === "obstacle")).toBe(true);
    expect(plan.report.pagesWithBrokenBalloons).toEqual(["p1"]);
  });

  it("rispetta le bande manuali (i volti, in v1)", () => {
    const s = strip([[2000]]);
    const band: Obstacle = { y: 900, height: 500, kind: "band", pageId: "p1", id: "p1-1" };
    const plan = sliceStrip(s, [band], POLICY);
    expectValid(plan, s);
    expect(plan.cuts.every((c) => c.y <= 900 || c.y >= 1400)).toBe(true);
  });
});

describe("sliceStrip — sovrapposizione, determinismo, report", () => {
  it("overlap_px allunga ogni immagine tranne l'ultima", () => {
    const s = strip([[1000, 1000, 1000]]);
    const plan = sliceStrip(s, [], { ...POLICY, overlapPx: 8 });
    plan.slices.forEach((slice, i) => {
      expect(slice.imageHeight).toBe(i === plan.slices.length - 1 ? slice.height : slice.height + 8);
    });
  });

  it("stesso input, stesso piano", () => {
    const s = strip([[900, 1500, 300], [2600], [400, 400]], 12);
    const obstacles = [balloon(1000, 200), balloon(3000, 150, "p2")];
    expect(sliceStrip(s, obstacles, POLICY)).toEqual(sliceStrip(s, obstacles, POLICY));
  });

  it("la metrica del gate conta le pagine con tagli da controllare", () => {
    const s = strip([[600, 600], [3000], [600, 600], [600, 600], [600, 600]]);
    const plan = sliceStrip(s, [], POLICY);
    expect(plan.report.pages).toBe(5);
    expect(plan.report.pagesToCheck).toEqual(["p2"]);
    expect(plan.report.checkRatio).toBeCloseTo(0.2, 6);
  });

  it("rifiuta una finestra [min, max] impossibile", () => {
    expect(() => sliceStrip(strip([[1000]]), [], { maxHeight: 600, minHeight: 700, overlapPx: 0 })).toThrow();
  });
});

describe("stripObstacles — i balloon misurati, coda compresa", () => {
  it("un balloon occupa il suo box più la coda, in coordinate di striscia", () => {
    const talking = samplePage.panels.find((p) => p.balloons.length > 0)!;
    const b = { ...talking.balloons[0]!, anchor: { x: 0.1, y: 0.2 }, tail: { mode: "manual" as const, target: { x: 0.3, y: 0.7 } } };
    const s: EpisodeStrip = {
      ...strip([[1000]]),
      placements: [{ pageId: "p1", panel: { ...talking, balloons: [b], slice_avoid: [{ from: 0.8, to: 0.9 }] }, box: { x: 0, y: 500, width: 1080, height: 1000 } }],
    };
    const fit: LetteringFit = { lines: [], fontSizePx: 20, blockHeight: 40, balloonWidth: 300, balloonHeight: 120 };
    const obstacles = stripObstacles(s, new Map([[b.id, fit]]));
    expect(obstacles).toContainEqual({ y: 700, height: 500, kind: "balloon", pageId: "p1", id: b.id }); // da 700 alla coda a 1200
    const band = obstacles.find((o) => o.kind === "band")!;
    expect(band.id).toBe(talking.id);
    expect(band.y).toBeCloseTo(1300, 6);
    expect(band.height).toBeCloseTo(100, 6);
  });
});
