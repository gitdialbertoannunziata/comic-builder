import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { chapterContext } from "../src/editor/chapters.js";
import { SceneSchema } from "../src/schema/scenes.js";

const build = (chapterId: string, scene = sampleScene) =>
  buildPagesFromScene({ scene, chapterId, firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "La lanterna" }, pages: build("ep001"), script: "copione 1" });

// La scena del secondo capitolo ha un id suo: gli id di scena sono per capitolo.
const scene2 = SceneSchema.parse({ ...sampleScene, id: "ep002-s001", title: "La barca" });

describe("Più capitoli in un'opera", () => {
  it("un capitolo nuovo prende il numero successivo, vuoto", () => {
    const next = applyCommand(doc, { type: "chapter.add", title: "La barca" });
    expect(next.chapters.chapters.map((c) => [c.id, c.number, c.title, c.pages.length])).toEqual([
      ["ep001", 1, "La lanterna", doc.chapters.chapters[0]!.pages.length],
      ["ep002", 2, "La barca", 0],
    ]);
  });

  it("lo spoglio di un capitolo non tocca gli altri", () => {
    const withTwo = applyCommand(doc, { type: "chapter.add", title: "La barca" });
    const filled = applyCommand(withTwo, { type: "chapter.set-content", chapterId: "ep002", pages: build("ep002", scene2), scenes: [scene2], script: "copione 2" });
    for (const id of doc.chapters.chapters[0]!.pages) expect(filled.pages[id]).toBe(doc.pages[id]);
    expect(filled.scenes.scenes.map((s) => s.id)).toEqual([sampleScene.id, "ep002-s001"]);
    expect(filled.scripts).toEqual({ ep001: "copione 1", ep002: "copione 2" });
    expect(filled.chapters.chapters[1]!.status).toBe("scripting");
    // Si scrivono solo i file del capitolo nuovo, più indici e scene.
    const writes = changedFiles(filled, withTwo).writes.map((w) => w.path);
    expect(writes.some((w) => w.includes("ep001-p"))).toBe(false);
    expect(writes.filter((w) => w.includes("ep002-p")).length).toBe(filled.chapters.chapters[1]!.pages.length);
  });

  it("rifare lo spoglio di un capitolo sostituisce le sue pagine e le sue scene, non quelle degli altri", () => {
    const withTwo = applyCommand(applyCommand(doc, { type: "chapter.add", title: "B" }), { type: "chapter.set-content", chapterId: "ep002", pages: build("ep002", scene2), scenes: [scene2] });
    const again = SceneSchema.parse({ ...scene2, id: "ep001-s001", title: "Rifatto" });
    const redone = applyCommand(withTwo, { type: "chapter.set-content", chapterId: "ep001", pages: build("ep001", again), scenes: [again] });
    expect(redone.scenes.scenes.map((s) => s.id).sort()).toEqual(["ep001-s001", "ep002-s001"]);
    expect(Object.keys(redone.pages).filter((id) => id.startsWith("ep002")).sort()).toEqual(Object.keys(withTwo.pages).filter((id) => id.startsWith("ep002")).sort());
  });

  it("le pagine di un altro capitolo sono rifiutate", () => {
    const withTwo = applyCommand(doc, { type: "chapter.add", title: "B" });
    expect(() => applyCommand(withTwo, { type: "chapter.set-content", chapterId: "ep002", pages: build("ep001"), scenes: [] })).toThrow(CommandError);
  });

  it("titolo e stato si modificano", () => {
    const next = applyCommand(doc, { type: "chapter.update", chapterId: "ep001", title: "Il faro spento", status: "in-production" });
    expect(next.chapters.chapters[0]).toMatchObject({ title: "Il faro spento", status: "in-production" });
  });
});

describe("Contesto degli altri capitoli per lo spoglio", () => {
  const withSheet = applyCommand(applyCommand(doc, { type: "character.upsert", ref: "sara", patch: { name: "Sara Bellini" } }), { type: "chapter.add", title: "B" });

  it("i personaggi già esistenti, con il nome della scheda", () => {
    const context = chapterContext(withSheet, "ep002");
    expect(context.characters).toContainEqual({ ref: "sara", name: "Sara Bellini" });
    expect(context.characters.map((c) => c.ref)).toContain("elio");
  });

  it("un riassunto breve del capitolo precedente", () => {
    const context = chapterContext(withSheet, "ep002", 400);
    expect(context.previously).toMatch(/^Capitolo 1 «La lanterna»:/);
    expect(context.previously!.length).toBeLessThanOrEqual(400);
    expect(chapterContext(withSheet, "ep001").previously).toBeNull();
  });
});
