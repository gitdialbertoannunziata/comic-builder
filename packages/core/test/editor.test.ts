import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, pagePath, projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { applyCommand, CommandError, type Command } from "../src/editor/commands.js";
import { canRedo, canUndo, createHistory, endGesture, execute, redo, undo, undoLabel, HISTORY_LIMIT } from "../src/editor/history.js";
import { validateDocument } from "../src/validate/validateDocument.js";
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
const P1 = pages[0]!.id;

function page(d: ProjectDoc, id = P1): Page {
  return d.pages[id]!;
}
function firstBalloon(d: ProjectDoc) {
  for (const p of Object.values(d.pages)) for (const panel of p.panels) if (panel.balloons[0]) return { pageId: p.id, panel, balloon: panel.balloons[0] };
  throw new Error("nessun balloon nel campione");
}
function valid(p: Page) {
  return validateDocument(p).filter((i) => i.level === "error");
}
function grid(p: Page) {
  if (p.layout.mode !== "page") throw new Error();
  return p.layout;
}

describe("Comandi sui balloon", () => {
  it("spostare sul target canonico cambia l'ancora; su un altro scrive un override", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const moved = applyCommand(doc, { type: "balloon.move", pageId, balloonId: balloon.id, anchor: { x: 0.5, y: 0.4 } });
    const b1 = firstBalloon(moved).balloon;
    expect(b1.anchor).toEqual({ x: 0.5, y: 0.4 });

    const onPrint = applyCommand(doc, { type: "balloon.move", pageId, balloonId: balloon.id, anchor: { x: 0.2, y: 0.3 }, target: "print-b5" });
    const b2 = firstBalloon(onPrint).balloon;
    expect(b2.anchor).toEqual(balloon.anchor);
    expect(b2.per_target["print-b5"]?.anchor).toEqual({ x: 0.2, y: 0.3 });
  });

  it("l'ancora resta dentro il pannello", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const moved = applyCommand(doc, { type: "balloon.move", pageId, balloonId: balloon.id, anchor: { x: 1.4, y: -0.2 } });
    expect(firstBalloon(moved).balloon.anchor).toEqual({ x: 1, y: 0 });
  });

  it("cambiare il testo alza rev (§5.6); un testo vuoto è rifiutato", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const edited = applyCommand(doc, { type: "balloon.text", pageId, balloonId: balloon.id, text: [{ t: "Nuovo testo" }] });
    expect(firstBalloon(edited).balloon.rev).toBe(balloon.rev + 1);
    expect(() => applyCommand(doc, { type: "balloon.text", pageId, balloonId: balloon.id, text: [{ t: "" }] })).toThrow(CommandError);
  });

  it("aggiungere un balloon usa un id nuovo; eliminarlo lo toglie", () => {
    const panel = page(doc).panels[0]!;
    const added = applyCommand(doc, { type: "balloon.add", pageId: P1, panelId: panel.id, text: [{ t: "Ehi" }] });
    const b = page(added).panels[0]!.balloons.at(-1)!;
    expect(b.id).toBe(`${panel.id}-b${panel.balloons.length + 1}`);
    const removed = applyCommand(added, { type: "balloon.remove", pageId: P1, balloonId: b.id });
    expect(page(removed).panels[0]!.balloons).toEqual(panel.balloons);
  });

  it("condivisione strutturale: un comando ricopia solo la pagina che tocca", () => {
    const { pageId, balloon } = firstBalloon(doc);
    const moved = applyCommand(doc, { type: "balloon.move", pageId, balloonId: balloon.id, anchor: { x: 0.3, y: 0.3 } });
    for (const id of Object.keys(doc.pages)) {
      if (id === pageId) expect(moved.pages[id]).not.toBe(doc.pages[id]);
      else expect(moved.pages[id]).toBe(doc.pages[id]);
    }
    expect(moved.chapters).toBe(doc.chapters);
    expect(changedFiles(moved, doc).writes.map((w) => w.path)).toEqual([pagePath(pageId)]);
  });
});

describe("Merge e split dei pannelli", () => {
  function adjacentPair(p: Page): [string, string] {
    for (const a of p.panels)
      for (const b of p.panels) {
        if (a.id === b.id) continue;
        if (a.area.row === b.area.row && a.area.row_span === b.area.row_span && a.area.col + a.area.col_span === b.area.col) return [a.id, b.id];
      }
    throw new Error("nessuna coppia affiancata");
  }

  it("due pannelli affiancati diventano uno, la griglia resta valida e i balloon non si perdono", () => {
    const pair = adjacentPair(page(doc));
    const before = page(doc).panels.flatMap((p) => p.balloons.map((b) => b.id)).sort();
    const merged = applyCommand(doc, { type: "panel.merge", pageId: P1, panelIds: pair });
    const p = page(merged);
    expect(p.panels).toHaveLength(page(doc).panels.length - 1);
    expect(valid(p)).toEqual([]);
    expect(p.panels.flatMap((x) => x.balloons.map((b) => b.id)).sort()).toEqual(before);
    expect(grid(p).reading_order).not.toContain(pair[1]);
  });

  it("i balloon restano nello stesso punto della pagina dopo il merge", () => {
    const pair = adjacentPair(page(doc));
    const withBalloon = applyCommand(doc, { type: "balloon.add", pageId: P1, panelId: pair[1], text: [{ t: "qui" }], anchor: { x: 0.5, y: 0.5 } });
    const merged = applyCommand(withBalloon, { type: "panel.merge", pageId: P1, panelIds: pair });
    const moved = page(merged).panels.find((p) => p.id === pair[0])!.balloons.find((b) => b.text[0]!.t === "qui")!;
    const g = grid(page(doc));
    const a = page(doc).panels.find((p) => p.id === pair[0])!.area;
    const b = page(doc).panels.find((p) => p.id === pair[1])!.area;
    // In unità di colonna: il centro del pannello b, espresso nel rettangolo unito.
    const total = g.cols.reduce((x, y) => x + y, 0);
    const start = (i: number) => g.cols.slice(0, i).reduce((x, y) => x + y, 0) / total;
    const bx = start(b.col) + 0.5 * (start(b.col + b.col_span) - start(b.col));
    const ux = start(a.col);
    const uw = start(b.col + b.col_span) - ux;
    expect(moved.anchor.x).toBeCloseTo((bx - ux) / uw, 9);
  });

  it("pannelli non affiancati: rifiutato, con un messaggio per l'utente", () => {
    const p = page(doc);
    const first = p.panels[0]!;
    const far = p.panels.find((x) => x.area.row > first.area.row + first.area.row_span)!;
    expect(far).toBeDefined();
    expect(() => applyCommand(doc, { type: "panel.merge", pageId: P1, panelIds: [first.id, far.id] })).toThrow(/affiancati/);
  });

  it("non si unisce un pannello che ha già l'arte", () => {
    const pair = adjacentPair(page(doc));
    const withArt = applyCommand(doc, { type: "panel.update", pageId: P1, panelId: pair[1], patch: { art: { source: "art/x.png", status: "inked" } } });
    expect(() => applyCommand(withArt, { type: "panel.merge", pageId: P1, panelIds: pair })).toThrow(/arte/);
  });

  it("split: per OGNI pannello del capitolo, in entrambe le direzioni, la griglia resta valida", () => {
    for (const p of pages) {
      for (const panel of p.panels) {
        for (const axis of ["cols", "rows"] as const) {
          const split = applyCommand(doc, { type: "panel.split", pageId: p.id, panelId: panel.id, axis });
          const result = page(split, p.id);
          expect(valid(result), `${panel.id} ${axis}`).toEqual([]);
          expect(result.panels).toHaveLength(p.panels.length + 1);
        }
      }
    }
  });

  it("il pannello nuovo prende un id mai usato, anche dopo una cancellazione", () => {
    const p = page(doc);
    const pair = adjacentPair(p);
    const merged = applyCommand(doc, { type: "panel.merge", pageId: P1, panelIds: pair });
    const split = applyCommand(merged, { type: "panel.split", pageId: P1, panelId: pair[0], axis: "cols" });
    const ids = page(split).panels.map((x) => x.id);
    // Il pannello tolto dal merge non torna in vita con un contenuto diverso.
    const highest = Math.max(...p.panels.map((x) => Number(x.id.split("-").at(-1))));
    expect(ids).toContain(`${P1}-${String(highest + 1).padStart(2, "0")}`);
  });

  it("split poi merge riportano allo stesso numero di pannelli e a una griglia valida", () => {
    const panel = page(doc).panels[0]!;
    const split = applyCommand(doc, { type: "panel.split", pageId: P1, panelId: panel.id, axis: "rows" });
    const added = page(split).panels.find((p) => !page(doc).panels.some((q) => q.id === p.id))!;
    const back = applyCommand(split, { type: "panel.merge", pageId: P1, panelIds: [panel.id, added.id] });
    expect(page(back).panels).toHaveLength(page(doc).panels.length);
    expect(valid(page(back))).toEqual([]);
  });
});

describe("Gutter e tracce", () => {
  it("i pesi delle tracce cambiano, il numero no", () => {
    const g = grid(page(doc));
    const cols = g.cols.map((w, i) => (i === 0 ? w * 1.5 : w));
    expect(grid(page(applyCommand(doc, { type: "layout.tracks", pageId: P1, cols }))).cols).toEqual(cols);
    expect(() => applyCommand(doc, { type: "layout.tracks", pageId: P1, cols: [1] })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: "layout.tracks", pageId: P1, cols: g.cols.map(() => 0) })).toThrow(CommandError);
  });
});

describe("Pagine del capitolo", () => {
  it("aggiungere una pagina da template la mette in coda con id e order coerenti", () => {
    const added = applyCommand(doc, { type: "page.add", chapterId: "ep001", templateId: "classic-6", sceneId: sampleScene.id });
    const ids = added.chapters.chapters[0]!.pages;
    expect(ids).toHaveLength(pages.length + 1);
    const newPage = added.pages[ids.at(-1)!]!;
    expect(newPage.order).toBe(ids.length);
    expect(valid(newPage)).toEqual([]);
  });

  it("spostare una pagina rinumera order, non gli id (§5.4)", () => {
    const last = pages.at(-1)!.id;
    const moved = applyCommand(doc, { type: "page.move", pageId: last, toIndex: 0 });
    const ids = moved.chapters.chapters[0]!.pages;
    expect(ids[0]).toBe(last);
    ids.forEach((id, i) => expect(moved.pages[id]!.order).toBe(i + 1));
  });

  it("eliminare una pagina: via dal capitolo e dal documento; l'ultima non si elimina", () => {
    const removed = applyCommand(doc, { type: "page.remove", pageId: P1 });
    expect(removed.pages[P1]).toBeUndefined();
    expect(removed.chapters.chapters[0]!.pages).not.toContain(P1);
    let single = removed;
    for (const id of removed.chapters.chapters[0]!.pages.slice(1)) single = applyCommand(single, { type: "page.remove", pageId: id });
    const only = single.chapters.chapters[0]!.pages[0]!;
    expect(() => applyCommand(single, { type: "page.remove", pageId: only })).toThrow(/senza pagine/);
  });

  it("un id di pagina cancellata non si riusa, nemmeno se era l'ultima", () => {
    const added = applyCommand(doc, { type: "page.add", chapterId: "ep001", templateId: "splash", sceneId: sampleScene.id });
    const newId = added.chapters.chapters[0]!.pages.at(-1)!;
    const removed = applyCommand(added, { type: "page.remove", pageId: newId });
    const again = applyCommand(removed, { type: "page.add", chapterId: "ep001", templateId: "splash", sceneId: sampleScene.id });
    expect(again.chapters.chapters[0]!.pages.at(-1)).not.toBe(newId);
  });

  it("il pannello con l'indice più alto, tolto da un merge, non torna con un altro contenuto", () => {
    const p = page(doc);
    const highest = p.panels.reduce((a, b) => (Number(a.id.slice(-2)) > Number(b.id.slice(-2)) ? a : b));
    const neighbour = p.panels.find(
      (x) => x.id !== highest.id && x.area.row === highest.area.row && x.area.row_span === highest.area.row_span &&
        (x.area.col + x.area.col_span === highest.area.col || highest.area.col + highest.area.col_span === x.area.col),
    )!;
    const order = grid(p).reading_order;
    // Il merge tiene quello che si legge prima: qui l'ultimo pannello sparisce.
    expect(order.indexOf(neighbour.id)).toBeLessThan(order.indexOf(highest.id));
    const merged = applyCommand(doc, { type: "panel.merge", pageId: P1, panelIds: [neighbour.id, highest.id] });
    const split = applyCommand(merged, { type: "panel.split", pageId: P1, panelId: neighbour.id, axis: "rows" });
    expect(page(split).panels.map((x) => x.id)).not.toContain(highest.id);
  });

  it("un balloon eliminato non cede il suo id al prossimo", () => {
    const panel = page(doc).panels[0]!;
    const added = applyCommand(doc, { type: "balloon.add", pageId: P1, panelId: panel.id, text: [{ t: "uno" }] });
    const id = page(added).panels[0]!.balloons.at(-1)!.id;
    const removed = applyCommand(added, { type: "balloon.remove", pageId: P1, balloonId: id });
    const again = applyCommand(removed, { type: "balloon.add", pageId: P1, panelId: panel.id, text: [{ t: "due" }] });
    expect(page(again).panels[0]!.balloons.at(-1)!.id).not.toBe(id);
  });
});

describe("Undo/redo (§11.3)", () => {
  const { pageId, balloon } = firstBalloon(doc);
  const move = (x: number): Command => ({ type: "balloon.move", pageId, balloonId: balloon.id, anchor: { x, y: 0.5 } });

  it("una sequenza di comandi produce un documento atteso, e si torna indietro esattamente", () => {
    let h = createHistory(doc);
    h = execute(h, move(0.1));
    h = execute(h, { type: "panel.camera", pageId: P1, panelId: page(doc).panels[0]!.id, camera: { shot: "CU" } });
    expect(page(h.present).panels[0]!.camera.shot).toBe("CU");
    expect(undoLabel(h)).toBe("Cambia camera");

    h = undo(undo(h));
    expect(h.present).toBe(doc);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(firstBalloon(h.present).balloon.anchor.x).toBe(0.1);
    expect(canRedo(h)).toBe(true);
  });

  it("un trascinamento è un solo passo di undo", () => {
    let h = createHistory(doc);
    for (let i = 1; i <= 60; i++) h = execute(h, move(i / 100), { gesture: "drag-1" });
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(doc);
  });

  it("due trascinamenti consecutivi sono due passi", () => {
    let h = createHistory(doc);
    h = execute(h, move(0.2), { gesture: "g" });
    h = endGesture(h);
    h = execute(h, move(0.3), { gesture: "g" });
    expect(h.past).toHaveLength(2);
  });

  it("un comando rifiutato lascia la cronologia com'era", () => {
    const h = createHistory(doc);
    expect(() => execute(h, { type: "page.remove", pageId: "inesistente" })).toThrow(CommandError);
    expect(h.past).toHaveLength(0);
  });

  it("un comando nuovo cancella il redo", () => {
    let h = execute(createHistory(doc), move(0.1));
    h = undo(h);
    h = execute(h, move(0.2));
    expect(canRedo(h)).toBe(false);
  });

  it("la cronologia ha un tetto", () => {
    let h = createHistory(doc);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = execute(h, move((i % 100) / 100 + 0.001));
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
