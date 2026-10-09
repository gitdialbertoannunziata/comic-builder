import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, loadProject, pagePath, PROJECT_FILE, projectDocFrom, saveProject, type ProjectDoc } from "../src/document/projectDoc.js";
import { MemoryProjectStore } from "../src/document/store.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { chapterContext, nextChapterId } from "../src/editor/chapters.js";
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

describe("Spostare ed eliminare un capitolo", () => {
  // Tre capitoli: il primo e il secondo spogliati, il terzo vuoto. Il secondo ha una correzione che vale per la serie.
  const filled = applyCommand(applyCommand(doc, { type: "chapter.add", title: "La barca" }), { type: "chapter.set-content", chapterId: "ep002", pages: build("ep002", scene2), scenes: [scene2], script: "copione 2" });
  const panel2 = filled.pages[filled.chapters.chapters[1]!.pages[0]!]!.panels[0]!;
  let three = applyCommand(filled, { type: "chapter.add", title: "Il molo" });
  three = applyCommand(three, { type: "revision.add", chapterId: "ep002", entries: [{ origin: "manual", kind: "note", panel: panel2.id, balloon: null, speaker: null, from: null, to: "x", source_line: null }], by: "autore", at: "2026-10-08T10:00:00Z" });
  three = applyCommand(three, { type: "revision.lesson", chapterId: "ep002", id: "r-0001", lesson: "Sara non dà mai del lei." });
  const order = (d: ProjectDoc) => d.chapters.chapters.map((c) => [c.id, c.number]);

  it("spostare cambia i numeri, non gli id, e riscrive solo l'indice dei capitoli", () => {
    const moved = applyCommand(three, { type: "chapter.move", chapterId: "ep003", toIndex: 0 });
    expect(order(moved)).toEqual([["ep003", 1], ["ep001", 2], ["ep002", 3]]);
    expect(moved.pages).toBe(three.pages);
    expect(changedFiles(moved, three)).toMatchObject({ writes: [{ path: three.project.chapters }], removes: [] });
    // Il capitolo «precedente» per lo spoglio è quello che ora viene prima.
    expect(chapterContext(moved, "ep001").previously).toBeNull();
    expect(chapterContext(moved, "ep002").previously).toMatch(/^Capitolo 2 «La lanterna»:/);
  });

  it("uno spostamento che non sposta niente non è un passo: il documento è lo stesso", () => {
    expect(applyCommand(three, { type: "chapter.move", chapterId: "ep001", toIndex: 0 })).toBe(three);
    expect(applyCommand(three, { type: "chapter.move", chapterId: "ep003", toIndex: 99 })).toBe(three);
    expect(order(applyCommand(three, { type: "chapter.move", chapterId: "ep001", toIndex: 99 }))).toEqual([["ep002", 1], ["ep003", 2], ["ep001", 3]]);
  });

  it("un'opera che parte dal capitolo 12 resta dal 12", () => {
    const from12: ProjectDoc = { ...three, chapters: { ...three.chapters, chapters: three.chapters.chapters.map((c) => ({ ...c, number: c.number + 11 })) } };
    expect(order(applyCommand(from12, { type: "chapter.move", chapterId: "ep002", toIndex: 0 }))).toEqual([["ep002", 12], ["ep001", 13], ["ep003", 14]]);
    expect(order(applyCommand(from12, { type: "chapter.remove", chapterId: "ep001" }))).toEqual([["ep002", 12], ["ep003", 13]]);
  });

  it("eliminare porta via pagine, scene, copione e changelog del capitolo, e i successivi scalano", () => {
    const removed = applyCommand(three, { type: "chapter.remove", chapterId: "ep002" });
    expect(order(removed)).toEqual([["ep001", 1], ["ep003", 2]]);
    expect(Object.keys(removed.pages).filter((id) => id.startsWith("ep002"))).toEqual([]);
    for (const id of doc.chapters.chapters[0]!.pages) expect(removed.pages[id]).toBe(doc.pages[id]);
    expect(removed.scenes.scenes.map((s) => s.id)).toEqual([sampleScene.id]);
    expect(removed.scripts).toEqual({ ep001: "copione 1" });
    expect(removed.revisions).toEqual({});

    const plan = changedFiles(removed, three);
    expect(plan.removes.sort()).toEqual([...filled.chapters.chapters[1]!.pages.map(pagePath), "revisions/ep002.json", "script/ep002.md"].sort());
    expect(plan.writes.map((w) => w.path).sort()).toEqual([PROJECT_FILE, three.project.scenes, three.project.chapters].sort());
  });

  it("una scena che usa anche un altro capitolo resta", () => {
    // Il terzo capitolo riusa la scena del secondo.
    const shared = applyCommand(three, { type: "chapter.set-content", chapterId: "ep003", pages: build("ep003", scene2), scenes: [scene2] });
    const removed = applyCommand(shared, { type: "chapter.remove", chapterId: "ep002" });
    expect(removed.scenes.scenes.map((s) => s.id)).toEqual([sampleScene.id, "ep002-s001"]);
  });

  it("ciò che l'autore ha tratto dalle correzioni del capitolo passa fra le regole della serie", () => {
    const noted = applyCommand(three, { type: "project.notes", notes: "Dialoghi brevi.\n" });
    const removed = applyCommand(noted, { type: "chapter.remove", chapterId: "ep002" });
    expect(removed.project.series_notes).toBe("Dialoghi brevi.\nSara non dà mai del lei.");
    expect(chapterContext(removed, "ep003").notes).toContain("Sara non dà mai del lei.");
    // Se è già fra le regole, o la ripete un altro capitolo, non si scrive due volte.
    const already = applyCommand(three, { type: "project.notes", notes: "sara non dà mai del lei." });
    expect(applyCommand(already, { type: "chapter.remove", chapterId: "ep002" }).project).toBe(already.project);
  });

  it("l'ultimo capitolo non si elimina, e uno che non c'è nemmeno", () => {
    expect(() => applyCommand(doc, { type: "chapter.remove", chapterId: "ep001" })).toThrow(CommandError);
    expect(() => applyCommand(three, { type: "chapter.remove", chapterId: "ep009" })).toThrow(CommandError);
    expect(() => applyCommand(three, { type: "chapter.move", chapterId: "ep009", toIndex: 0 })).toThrow(CommandError);
  });

  it("l'id di un capitolo eliminato non si riusa: in art/ ci sono ancora le sue immagini", () => {
    const removed = applyCommand(three, { type: "chapter.remove", chapterId: "ep003" });
    expect(nextChapterId(removed)).toEqual({ id: "ep004", number: 3 });
    expect(order(applyCommand(removed, { type: "chapter.add", title: "" }))).toEqual([["ep001", 1], ["ep002", 2], ["ep004", 3]]);
  });

  it("sul disco non resta niente del capitolo, e annullare lo riporta intero", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, three, null);
    const before = store.paths();
    const removed = applyCommand(three, { type: "chapter.remove", chapterId: "ep002" });
    await saveProject(store, removed, three);
    expect(store.paths().filter((path) => path.includes("ep002"))).toEqual([]);
    const reopened = await loadProject(store);
    expect(reopened.issues).toEqual([]);
    expect(order(reopened.doc)).toEqual([["ep001", 1], ["ep003", 2]]);
    // Ctrl+Z, poi il salvataggio: tornano gli stessi file di prima.
    await saveProject(store, three, removed);
    expect(store.paths()).toEqual(before);
    expect(order((await loadProject(store)).doc)).toEqual([["ep001", 1], ["ep002", 2], ["ep003", 3]]);
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

describe("Nome e progetto nuovo", () => {
  it("rinominare cambia il titolo, non l'id", async () => {
    const next = applyCommand(doc, { type: "project.rename", title: "Il guardiano" });
    expect(next.project.title).toBe("Il guardiano");
    expect(next.project.id).toBe(doc.project.id);
  });

  it("un progetto nuovo è un'opera vuota con un capitolo pronto, e si può salvare", async () => {
    const { emptyProjectDoc, saveProject, loadProject } = await import("../src/document/projectDoc.js");
    const { MemoryProjectStore } = await import("../src/document/store.js");
    const fresh = emptyProjectDoc(sampleProject, "La Città di Sale", new Date("2026-09-21T10:00:00Z"));
    expect(fresh.project).toMatchObject({ id: "la-citta-di-sale", title: "La Città di Sale" });
    expect(fresh.chapters.chapters).toEqual([{ id: "ep001", number: 1, title: "Capitolo 1", status: "planned", pages: [] }]);
    const store = new MemoryProjectStore();
    await saveProject(store, fresh, null);
    expect((await loadProject(store)).doc.project.title).toBe("La Città di Sale");
  });
});

describe("Contesto per la continuità fra capitoli", () => {
  it("porta schede (aspetto e costumi), luoghi degli altri capitoli e regole della serie", () => {
    let d = applyCommand(doc, { type: "character.upsert", ref: "sara", patch: { name: "Sara", summary: "tecnica", appearance: { age: "30s" }, wardrobe: { notte: "raincoat" } } });
    d = applyCommand(d, { type: "project.notes", notes: "  Dialoghi brevi.  " });
    d = applyCommand(d, { type: "chapter.add", title: "B" });
    const context = chapterContext(d, "ep002");
    expect(context.characters).toContainEqual({ ref: "sara", name: "Sara", summary: "tecnica", appearance: "30s", wardrobe: { notte: "raincoat" } });
    expect(context.locations).toEqual([sampleScene.location]);
    expect(context.notes).toBe("Dialoghi brevi.");
    // I luoghi del capitolo stesso non contano come «già visti».
    expect(chapterContext(d, "ep001").locations).toEqual([]);
  });

  it("porta ciò che l'autore ha tratto dalle correzioni, in ogni capitolo", () => {
    expect(chapterContext(doc, "ep001").lessons).toEqual([]);
    const panel = doc.pages[doc.chapters.chapters[0]!.pages[0]!]!.panels[0]!;
    let d = applyCommand(doc, { type: "revision.add", chapterId: "ep001", entries: [{ origin: "manual", kind: "note", panel: panel.id, balloon: null, speaker: null, from: null, to: "x", source_line: null }], by: "autore", at: "2026-10-08T10:00:00Z" });
    d = applyCommand(d, { type: "revision.lesson", chapterId: "ep001", id: "r-0001", lesson: "Sara non dà mai del lei." });
    d = applyCommand(d, { type: "chapter.add", title: "B" });
    expect(chapterContext(d, "ep002").lessons).toEqual(["Sara non dà mai del lei."]);
  });
});
