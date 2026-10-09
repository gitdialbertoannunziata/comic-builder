import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { loadProject, projectDocFrom, saveProject, type ProjectDoc } from "../src/document/projectDoc.js";
import { MemoryProjectStore } from "../src/document/store.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { locationRef, projectLocations, sceneLocation } from "../src/editor/locations.js";
import { SceneSchema } from "../src/schema/scenes.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const second = SceneSchema.parse({ ...sampleScene, id: "s2", location: "  Il Garage di Marco ", beats: [] });
const elsewhere = SceneSchema.parse({ ...sampleScene, id: "s3", location: "Il molo", beats: [] });
const doc: ProjectDoc = { ...projectDocFrom({ project: sampleProject, scenes: [sampleScene, second, elsewhere], chapter: { id: "ep001", number: 1, title: "x" }, pages }) };

describe("Luoghi dell'opera", () => {
  it("il ref deriva dal nome che le scene usano; un luogo «non specificato» non ne ha", () => {
    expect(locationRef("La stanza")).toBe("la_stanza");
    expect(locationRef("Dentro la testa — Villaggio nel deserto")).toBe("dentro_la_testa_villaggio_nel_deserto");
    expect(locationRef("non specificato")).toBe("");
    expect(locationRef("")).toBe("");
  });

  it("i luoghi nominati dalle scene, i più usati prima, con la scheda se c'è", () => {
    const withSheet = applyCommand(doc, { type: "location.upsert", ref: "il_molo", patch: { name: "Il molo", description: "wooden pier" } });
    const list = projectLocations(withSheet);
    expect(list.map((l) => [l.ref, l.scenes.length, l.sheet?.description ?? null])).toEqual([
      [locationRef(sampleScene.location), 1, null],
      ["il_garage_di_marco", 1, null],
      ["il_molo", 1, "wooden pier"],
    ].sort((a, b) => (b[1] as number) - (a[1] as number) || 0));
    expect(sceneLocation(withSheet, elsewhere)?.sheet?.description).toBe("wooden pier");
    expect(sceneLocation(withSheet, { location: "non specificato" })).toBeNull();
  });

  it("una scheda si crea e si aggiorna a pezzi; il ref dev'essere già un ref", () => {
    let d = applyCommand(doc, { type: "location.upsert", ref: "il_molo", patch: { description: "wooden pier" } });
    d = applyCommand(d, { type: "location.upsert", ref: "il_molo", patch: { palette: "grey, rust" } });
    expect(d.locations.il_molo).toMatchObject({ schema: 1, id: "il_molo", description: "wooden pier", palette: "grey, rust", references: [] });
    expect(() => applyCommand(doc, { type: "location.upsert", ref: "Il molo", patch: {} })).toThrow(CommandError);
    expect(applyCommand(d, { type: "location.remove", ref: "il_molo" }).locations).toEqual({});
  });

  it("lo stile si aggiorna a pezzi: le tavole senza toccare il testo, e viceversa", () => {
    let d = applyCommand(doc, { type: "project.style", positive: ["ink", " flat colours "], negative: [] });
    d = applyCommand(d, { type: "project.style", references: [{ path: "style/a.png", note: "", use: true }] });
    expect(d.project.style).toMatchObject({ positive: ["ink", "flat colours"], references: [{ path: "style/a.png" }] });
    d = applyCommand(d, { type: "project.style", preset: "noir-ink" });
    expect(d.project.style).toMatchObject({ preset: "noir-ink", positive: ["ink", "flat colours"] });
  });

  it("schede e stile vanno su disco, e tornano; togliere una scheda toglie il suo file", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    const d = applyCommand(applyCommand(doc, { type: "location.upsert", ref: "il_molo", patch: { name: "Il molo", references: [{ path: "locations/il_molo/a.png", note: "", use: true }] } }), {
      type: "project.style",
      references: [{ path: "style/a.png", note: "", use: false }],
    });
    await saveProject(store, d, doc);
    expect(store.paths()).toContain("locations/il_molo.json");
    const reopened = await loadProject(store);
    expect(reopened.issues).toEqual([]);
    expect(reopened.doc.locations.il_molo?.references).toEqual([{ path: "locations/il_molo/a.png", note: "", use: true }]);
    expect(reopened.doc.project.style.references).toEqual([{ path: "style/a.png", note: "", use: false }]);
    const removed = applyCommand(d, { type: "location.remove", ref: "il_molo" });
    await saveProject(store, removed, d);
    expect(store.paths()).not.toContain("locations/il_molo.json");
  });

  it("un progetto di prima, senza luoghi né tavole di stile, si apre", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    const raw = JSON.parse((await store.readText("project.json"))!);
    delete raw.style.references;
    await store.writeText("project.json", JSON.stringify(raw));
    const { doc: opened } = await loadProject(store);
    expect(opened.project.style.references).toEqual([]);
    expect(opened.locations).toEqual({});
  });
});
