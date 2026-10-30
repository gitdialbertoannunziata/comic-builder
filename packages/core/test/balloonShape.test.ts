import { describe, expect, it } from "vitest";
import { computePageFits } from "@comic-builder/lettering";
import { loadSampleFont } from "@comic-builder/lettering/sampleFont";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { samplePage } from "../src/fixtures/sample-page.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { validateDocument } from "../src/validate/validateDocument.js";
import { pageForTarget } from "../src/targets/pageTarget.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { renderPageSvg } from "../src/render/renderSvg.js";
import { balloonShape, rotatePoint, shapePath, shapeTextScale, tailGeometry } from "../src/render/balloonShape.js";
import { BalloonShapeSchema, type Balloon } from "../src/schema/balloon.js";
import { BalloonStyleSchema, DraftStyleSchema, LetteringConfigSchema } from "../src/schema/project.js";
import type { Page } from "../src/schema/page.js";

const pages = buildPagesFromScene({
  scene: sampleScene,
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "Il faro" }, pages });

function firstBalloon(d: ProjectDoc) {
  for (const p of Object.values(d.pages)) for (const panel of p.panels) if (panel.balloons[0]) return { pageId: p.id, balloon: panel.balloons[0] };
  throw new Error("nessun balloon nel campione");
}

describe("Comandi di forma e trasformazione", () => {
  it("ridimensionare sul formato principale scrive dimensioni e ancora; null torna al testo", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const sized = applyCommand(doc, { type: "balloon.resize", pageId, balloonId: balloon.id, size: { w: 0.4, h: 0.2 }, anchor: { x: 0.1, y: 0.1 } });
    const b = firstBalloon(sized).balloon;
    expect(b.size).toEqual({ w: 0.4, h: 0.2 });
    expect(b.anchor).toEqual({ x: 0.1, y: 0.1 });
    expect(validateDocument(sized.pages[pageId]!).filter((i) => i.level === "error")).toEqual([]);

    const back = applyCommand(sized, { type: "balloon.resize", pageId, balloonId: balloon.id, size: null });
    expect(firstBalloon(back).balloon.size).toBeUndefined();
  });

  it("su un altro formato le dimensioni sono un override, e null le toglie solo lì", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const sized = applyCommand(doc, { type: "balloon.resize", pageId, balloonId: balloon.id, size: { w: 0.5, h: 0.3 } });
    const onPrint = applyCommand(sized, { type: "balloon.resize", pageId, balloonId: balloon.id, size: null, target: "print-b5" });
    const b = firstBalloon(onPrint).balloon;
    expect(b.size).toEqual({ w: 0.5, h: 0.3 });
    expect(b.per_target["print-b5"]?.size).toBeNull();
    expect(pageForTarget(onPrint.pages[pageId]!, "print-b5").panels.flatMap((p) => p.balloons).find((x) => x.id === balloon.id)?.size).toBeUndefined();
  });

  it("una dimensione nulla o oltre il pannello si riporta nei limiti", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const sized = applyCommand(doc, { type: "balloon.resize", pageId, balloonId: balloon.id, size: { w: 3, h: 0 } });
    expect(firstBalloon(sized).balloon.size).toEqual({ w: 1, h: 0.02 });
  });

  it("forma e rotazione passano da balloon.update; dritto non si scrive", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const turned = applyCommand(doc, { type: "balloon.update", pageId, balloonId: balloon.id, patch: { shape: "cloud", rotation: -12 } });
    expect(firstBalloon(turned).balloon).toMatchObject({ shape: "cloud", rotation: -12 });
    const straight = applyCommand(turned, { type: "balloon.update", pageId, balloonId: balloon.id, patch: { rotation: 0 } });
    expect("rotation" in firstBalloon(straight).balloon).toBe(false);
    expect(() => applyCommand(doc, { type: "balloon.update", pageId, balloonId: balloon.id, patch: { rotation: 270 } })).toThrow(CommandError);
  });
});

describe("Geometria delle forme", () => {
  const box = { x: 100, y: 100, width: 300, height: 160 };

  it("senza forma scelta vale quella di sempre: arrotondato, niente per gli sfx", () => {
    expect(balloonShape({ type: "speech" })).toBe("rounded");
    expect(balloonShape({ type: "sfx" })).toBe("none");
    expect(balloonShape({ type: "sfx", shape: "burst" })).toBe("burst");
  });

  it("ogni forma tracciata resta nel suo box, ed è deterministica", () => {
    for (const shape of ["cloud", "burst", "spiky", "wavy"] as const) {
      const d = shapePath(shape, box)!;
      expect(d).toBe(shapePath(shape, box));
      const numbers = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      // Gli archi della nuvola hanno anche raggi fra i numeri: si controllano solo i punti finali, che stanno sul contorno.
      for (const p of shape === "cloud" ? numbers.filter((_, i) => i === 0 || i % 2 === 0) : numbers) {
        expect(p.x).toBeGreaterThanOrEqual(box.x - 0.5);
        expect(p.x).toBeLessThanOrEqual(box.x + box.width + 0.5);
        expect(p.y).toBeGreaterThanOrEqual(box.y - 0.5);
        expect(p.y).toBeLessThanOrEqual(box.y + box.height + 0.5);
      }
    }
  });

  it("le forme tonde chiedono più spazio del testo, quelle squadrate no", () => {
    expect(shapeTextScale("rounded")).toEqual({ x: 1, y: 1 });
    expect(shapeTextScale("ellipse").x).toBeGreaterThan(1);
    expect(shapeTextScale("burst").y).toBeGreaterThan(shapeTextScale("ellipse").y);
  });

  it("una coda a pallini sono tre cerchi decrescenti verso la punta", () => {
    const tip = { x: 250, y: 420 };
    const tail = tailGeometry("cloud", box, tip, { bubbles: true }, 20);
    expect(tail.path).toBe("");
    expect(tail.bubbles).toHaveLength(3);
    expect(tail.bubbles[0]!.r).toBeGreaterThan(tail.bubbles[2]!.r);
    expect(tail.bubbles[2]!.cy).toBeGreaterThan(tail.bubbles[0]!.cy);
  });

  it("una coda curva è fatta di quadratiche e arriva alla punta", () => {
    const tail = tailGeometry("rounded", box, { x: 250, y: 420 }, { curve: 0.5, width: 2 }, 20);
    expect(tail.path).toContain("Q");
    expect(tail.path).toContain("250,420");
  });

  it("ruotare e ruotare indietro riporta al punto di partenza", () => {
    const c = { x: 10, y: 10 };
    const p = rotatePoint(rotatePoint({ x: 40, y: 25 }, c, 33), c, -33);
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(25);
  });
});

describe("Render di forme, dimensioni e rotazione", () => {
  const font = loadSampleFont();
  const lettering = LetteringConfigSchema.parse({ font_family: "ComicNeue", base_size_px: 26, line_height: 1.35, padding: 12, max_width_ratio: 0.62, tail_width: 10 });
  const layout = samplePage.layout.mode === "page" ? samplePage.layout : null;
  if (!layout) throw new Error("fixture non in modalità page");
  const boxes = resolvePageLayout(layout, samplePage.panels, 1488, 2288, 56, 56);
  const config = {
    width: 1600,
    height: 2400,
    fontFamily: "ComicNeue",
    lineHeight: 1.35,
    padding: 12,
    tailWidthPx: 10,
    balloonStyle: BalloonStyleSchema.parse({}),
    draftStyle: DraftStyleSchema.parse({}),
    baseFontSizePx: 26,
    target: "digital-page",
    draft: false,
  };

  function withBalloon(change: (b: Balloon) => Balloon): Page {
    return { ...samplePage, panels: samplePage.panels.map((p) => ({ ...p, balloons: p.balloons.map(change) })) };
  }
  function fitsFor(page: Page) {
    return computePageFits({ page, boxes, font, lettering, draftStyle: config.draftStyle, target: "digital-page", draft: false });
  }
  const id = samplePage.panels.flatMap((p) => p.balloons)[0]!.id;
  const panelBox = boxes.get(samplePage.panels.find((p) => p.balloons.length > 0)!.id)!;

  it("ogni forma si disegna", () => {
    for (const shape of BalloonShapeSchema.options) {
      const page = withBalloon((b) => ({ ...b, shape }));
      const svg = renderPageSvg(page, boxes, fitsFor(page), config);
      if (shape === "ellipse") expect(svg).toContain("<ellipse");
      else if (shape === "rect") expect(svg).toContain('rx="0"');
      else if (shape === "none") expect(svg).not.toContain("<path");
      else if (shape !== "rounded") expect(svg).toMatch(/<path d="M[^"]+Z" fill="white"/);
      expect(svg).toContain("niente");
    }
  });

  it("un'ellisse ha un box più grande del rettangolo per lo stesso testo", () => {
    const rounded = fitsFor(samplePage).get(id)!;
    const ellipse = fitsFor(withBalloon((b) => ({ ...b, shape: "ellipse" }))).get(id)!;
    expect(ellipse.balloonWidth).toBeGreaterThan(rounded.balloonWidth);
    expect(ellipse.fontSizePx).toBe(rounded.fontSizePx);
  });

  it("con una dimensione scelta il box è quella, e il testo va a capo dentro", () => {
    const page = withBalloon((b) => ({ ...b, size: { w: 0.3, h: 0.5 } }));
    const fit = fitsFor(page).get(id)!;
    expect(fit.balloonWidth).toBeCloseTo(panelBox.width * 0.3);
    expect(fit.balloonHeight).toBeCloseTo(panelBox.height * 0.5);
  });

  it("la rotazione avvolge balloon e testo in un gruppo ruotato attorno al centro", () => {
    const page = withBalloon((b) => ({ ...b, rotation: 15 }));
    const svg = renderPageSvg(page, boxes, fitsFor(page), config);
    expect(svg).toMatch(/<g transform="rotate\(15 [\d.]+ [\d.]+\)">.*niente.*<\/g>/);
  });
});
