import { describe, expect, it } from "vitest";
import { sampleProject, samplePage, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { loadProject, projectDocFrom, saveProject, type ProjectDoc } from "../src/document/projectDoc.js";
import { MemoryProjectStore } from "../src/document/store.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { lintCharacters } from "../src/validate/lintCharacters.js";
import { compilePanel } from "../src/compile/promptCompiler.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages });
const withSara = applyCommand(doc, {
  type: "character.upsert",
  ref: "sara",
  patch: {
    name: "Sara Bellini",
    appearance: { age: "woman in her 30s", hair: "short black hair", distinguishing: "scar on left eyebrow" },
    wardrobe: { default: "grey work overalls, tool belt", notte: "dark raincoat, hood up" },
    palette: "slate grey, rust orange",
    references: [{ path: "characters/sara/fronte.png", note: "" }],
  },
});

describe("Schede personaggio (§5.1)", () => {
  it("si creano e si modificano per parti, senza perdere il resto", () => {
    const next = applyCommand(withSara, { type: "character.upsert", ref: "sara", patch: { appearance: { eyes: "green eyes" } } });
    expect(next.characters.sara!.appearance).toMatchObject({ age: "woman in her 30s", hair: "short black hair", eyes: "green eyes" });
    expect(next.characters.sara!.name).toBe("Sara Bellini");
  });

  it("il ref deve essere un ref: minuscolo, senza spazi né accenti", () => {
    expect(() => applyCommand(doc, { type: "character.upsert", ref: "Sara B", patch: {} })).toThrow(CommandError);
  });

  it("si salvano in characters/<ref>.json e si riaprono", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, withSara, null);
    expect(store.paths()).toContain("characters/sara.json");
    await store.writeBytes("characters/sara/fronte.png", new Uint8Array([1]));
    const { doc: reopened } = await loadProject(store);
    expect(reopened.characters).toEqual(withSara.characters);
  });

  it("rinominare il personaggio sposta anche la scheda, e il file vecchio sparisce", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, withSara, null);
    const renamed = applyCommand(withSara, { type: "character.rename", from: "sara", to: "Silvia" });
    expect(renamed.characters.sara).toBeUndefined();
    expect(renamed.characters.silvia).toMatchObject({ id: "silvia", name: "Sara Bellini" });
    await saveProject(store, renamed, withSara);
    expect(store.paths()).toContain("characters/silvia.json");
    expect(store.paths()).not.toContain("characters/sara.json");
  });
});

describe("Il compilatore usa le schede", () => {
  const layout = samplePage.layout;
  if (layout.mode !== "page") throw new Error();
  const boxes = resolvePageLayout(layout, samplePage.panels, 1488, 2288, 56, 56);
  const panel = samplePage.panels.find((p) => p.characters.length > 0)!;
  const ref = panel.characters[0]!.ref;
  const sheet = applyCommand(doc, {
    type: "character.upsert",
    ref,
    patch: { name: "Alex", appearance: { age: "man in his 40s", hair: "short grey beard" }, wardrobe: { default: "worn leather jacket" }, references: [{ path: `characters/${ref}/a.png`, note: "" }] },
  }).characters;
  const compile = (characters = sheet) => compilePanel({ project: sampleProject, page: samplePage, panel, panelBox: boxes.get(panel.id)!, targetId: "t", characters });

  it("l'aspetto e il costume entrano nel prompt compatto", () => {
    expect(compile().positive).toContain(`${ref} (lead, man in his 40s, short grey beard`);
    expect(compile().positive).toContain("wearing worn leather jacket");
  });

  it("il brief chiede coerenza, e dice quali immagini di riferimento allegare", () => {
    const brief = compile().brief;
    expect(brief).toContain("keep each one consistent with this description in every panel");
    expect(brief).toContain(`- ${ref} «Alex»`);
    expect(brief).toContain(`reference images: characters/${ref}/a.png`);
  });

  it("senza scheda il testo è quello di prima", () => {
    expect(compile({}).brief).toMatch(/^Characters: /m);
  });
});

describe("Lint dei personaggi (Appendice A)", () => {
  it("personaggi senza scheda: un'informazione per personaggio, non per pannello", () => {
    const codes = lintCharacters(doc).filter((i) => i.code === "content.no-character-sheet").map((i) => i.path);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("characters[sara]");
    expect(lintCharacters(withSara).some((i) => i.path === "characters[sara]")).toBe(false);
  });

  it("costume non specificato con più varianti e nessun default: avviso", () => {
    const noDefault = applyCommand(doc, { type: "character.upsert", ref: "sara", patch: { wardrobe: { giorno: "overalls", notte: "raincoat" } } });
    expect(lintCharacters(noDefault).map((i) => i.code)).toContain("content.wardrobe-unspecified");
  });

  it("costume che la scheda non conosce: avviso", () => {
    const pageId = pages.find((p) => p.panels.some((x) => x.characters.some((c) => c.ref === "sara")))!.id;
    const panel = doc.pages[pageId]!.panels.find((x) => x.characters.some((c) => c.ref === "sara"))!;
    const next = applyCommand(withSara, {
      type: "panel.update",
      pageId,
      panelId: panel.id,
      patch: { characters: panel.characters.map((c) => (c.ref === "sara" ? { ...c, wardrobe: "Notte" } : c)) },
    });
    expect(lintCharacters(next).map((i) => i.code)).toContain("content.wardrobe-unknown");
  });
});
