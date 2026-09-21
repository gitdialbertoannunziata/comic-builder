import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { applyCommand } from "../src/editor/commands.js";
import { artCommands, artPathFor, isArtFile, missingArt, artMediaType } from "../src/art/artLink.js";
import { renderPageSvg } from "../src/render/renderSvg.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { BalloonStyleSchema, DraftStyleSchema } from "../src/schema/project.js";
import { planTargetExport } from "../src/targets/exportPlan.js";
import { LetteringConfigSchema } from "../src/schema/project.js";

const pages = buildPagesFromScene({
  scene: sampleScene,
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages });
const panel = pages[0]!.panels[2]!;

function applyAll(d: ProjectDoc, files: { path: string; sha: string }[]) {
  return artCommands(d, files).reduce(applyCommand, d);
}
function art(d: ProjectDoc, id = panel.id) {
  for (const p of Object.values(d.pages)) for (const x of p.panels) if (x.id === id) return x.art;
  throw new Error(id);
}

describe("Arte collegata per nome (criterio d'uscita di F2)", () => {
  it("un file col nome del pannello lo collega, con sha e stato sketch", () => {
    const next = applyAll(doc, [{ path: `art/${panel.id}.png`, sha: "aaa" }]);
    expect(art(next)).toEqual({ source: `art/${panel.id}.png`, status: "sketch", sha: "aaa" });
  });

  it("il nome si confronta senza distinguere le maiuscole (filesystem di macOS e Windows)", () => {
    const next = applyAll(doc, [{ path: `art/${panel.id.toUpperCase()}.PNG`, sha: "aaa" }]);
    expect(art(next).source).toBe(`art/${panel.id.toUpperCase()}.PNG`);
  });

  it("un file modificato aggiorna lo sha; uno invariato non produce comandi", () => {
    const linked = applyAll(doc, [{ path: `art/${panel.id}.png`, sha: "aaa" }]);
    expect(artCommands(linked, [{ path: `art/${panel.id}.png`, sha: "aaa" }])).toEqual([]);
    expect(art(applyAll(linked, [{ path: `art/${panel.id}.png`, sha: "bbb" }])).sha).toBe("bbb");
  });

  it("il collegamento esplicito vince su quello per nome", () => {
    const explicit = applyCommand(doc, {
      type: "panel.update",
      pageId: pages[0]!.id,
      panelId: panel.id,
      patch: { art: { source: "art/altro-nome.png", status: "inked", sha: "x" } },
    });
    const next = applyAll(explicit, [{ path: `art/${panel.id}.png`, sha: "zzz" }]);
    expect(art(next).source).toBe("art/altro-nome.png");
  });

  it("file che non sono immagini, o non corrispondono a un pannello, si ignorano", () => {
    expect(artCommands(doc, [{ path: `art/${panel.id}.psd`, sha: "1" }, { path: "art/appunti.png", sha: "2" }])).toEqual([]);
    expect(isArtFile("x.JPG")).toBe(true);
    expect(artMediaType("art/a.webp")).toBe("image/webp");
    expect(artPathFor(panel.id, ".PNG")).toBe(`art/${panel.id}.png`);
  });

  it("un file sparito non scollega: si segnala come mancante", () => {
    const linked = applyAll(doc, [{ path: `art/${panel.id}.png`, sha: "aaa" }]);
    expect(artCommands(linked, [])).toEqual([]);
    expect(missingArt(linked, new Set())).toEqual([{ pageId: pages[0]!.id, panelId: panel.id, source: `art/${panel.id}.png` }]);
  });
});

describe("Render dell'arte", () => {
  const linked = applyAll(doc, [{ path: `art/${panel.id}.png`, sha: "aaa" }]);
  const page = linked.pages[pages[0]!.id]!;
  if (page.layout.mode !== "page") throw new Error();
  const boxes = resolvePageLayout(page.layout, page.panels, 1488, 2288, 56, 56);
  const config = {
    width: 1600,
    height: 2400,
    fontFamily: "Comic Neue",
    lineHeight: 1.35,
    padding: 12,
    tailWidthPx: 10,
    balloonStyle: BalloonStyleSchema.parse({}),
    draftStyle: DraftStyleSchema.parse({}),
    baseFontSizePx: 26,
    target: "digital-page",
  };

  it("l'immagine riempie il pannello, ritagliata sul suo bordo, sotto i balloon", () => {
    const svg = renderPageSvg(page, boxes, new Map(), { ...config, art: new Map([[panel.id, "data:image/png;base64,AAAA"]]) });
    const box = boxes.get(panel.id)!;
    expect(svg).toContain(`<image href="data:image/png;base64,AAAA" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice"`);
    expect(svg).toContain(`clip-path="url(#cb-clip-${panel.id})"`);
  });

  it("con l'arte il layer bozza del pannello sparisce", () => {
    const svg = renderPageSvg(page, boxes, new Map(), { ...config, art: new Map([[panel.id, "x.png"]]) });
    const without = renderPageSvg(page, boxes, new Map(), config);
    expect(svg).not.toContain("arte non trovata");
    expect(without).toContain(`arte non trovata: art/${panel.id}.png`);
  });

  it("nell'export un'arte non trovata è un errore, non un pannello vuoto in silenzio", () => {
    const plan = planTargetExport(
      {
        project: sampleProject,
        pages: Object.values(linked.pages),
        chapter: { id: "ep001" },
        styles: { lettering: LetteringConfigSchema.parse(sampleProject.lettering), balloonStyle: BalloonStyleSchema.parse({}), draftStyle: DraftStyleSchema.parse({}) },
        measure: () => new Map(),
      },
      "digital-page",
    );
    expect(plan.issues.map((i) => i.code)).toContain("export.missing-art");
  });
});
