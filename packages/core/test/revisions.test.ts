import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, loadProject, projectDocFrom, revisionsPath, saveProject, type ProjectDoc } from "../src/document/projectDoc.js";
import { MemoryProjectStore } from "../src/document/store.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { revisionConflict, locate, type NewRevision } from "../src/revisions/revisionCommands.js";
import { lintRevisions } from "../src/revisions/lintRevisions.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages, script: "# copione\n" });
const AT = "2026-09-22T10:00:00Z";
const talking = pages.flatMap((p) => p.panels).find((p) => p.balloons.length > 0)!;
const balloon = talking.balloons[0]!;
const text = balloon.text.map((r) => r.t).join("");

function correction(to: string, from = text): NewRevision {
  return { origin: "annotated", kind: "text", panel: talking.id, balloon: balloon.id, speaker: null, from, to, source_line: null };
}
const add = (d: ProjectDoc, entries: NewRevision[]) => applyCommand(d, { type: "revision.add", chapterId: "ep001", entries, by: "sceneggiatore", at: AT });
const entries = (d: ProjectDoc) => d.revisions.ep001!.entries;

describe("Changelog delle revisioni (§10.2)", () => {
  it("le correzioni importate hanno id progressivi, stato open, chi e quando", () => {
    const d = add(doc, [correction("Uno."), correction("Due.")]);
    expect(entries(d).map((e) => [e.id, e.status, e.by, e.at])).toEqual([
      ["r-0001", "open", "sceneggiatore", AT],
      ["r-0002", "open", "sceneggiatore", AT],
    ]);
  });

  it("la stessa correzione importata due volte non si duplica", () => {
    const d = add(add(doc, [correction("Uno.")]), [correction("Uno.")]);
    expect(entries(d)).toHaveLength(1);
  });

  it("applicare cambia il testo, alza rev, e segna la voce con la rev risultante", () => {
    const d = add(doc, [correction("Da quanto è spenta?")]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "autore", at: AT });
    const b = locate(applied, { panel: null, balloon: balloon.id })!.balloon!;
    expect(b.text).toEqual([{ t: "Da quanto è spenta?" }]);
    expect(b.rev).toBe(balloon.rev + 1);
    expect(entries(applied)[0]).toMatchObject({ status: "applied", rev: b.rev, resolved_by: "autore", resolved_at: AT });
  });

  it("applicare tocca solo i balloon coinvolti: il resto è condiviso per riferimento", () => {
    const d = add(doc, [correction("Nuovo.")]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    const writes = changedFiles(applied, d).writes.map((w) => w.path).sort();
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    expect(writes).toEqual([`pages/${pageOf}.json`, revisionsPath("ep001")].sort());
    for (const p of applied.pages[pageOf]!.panels) {
      for (const b of p.balloons) if (b.id !== balloon.id) expect(b).toBe(locate(d, { panel: null, balloon: b.id })!.balloon);
      expect(p.art).toBe(d.pages[pageOf]!.panels.find((x) => x.id === p.id)!.art);
    }
  });

  it("un testo cambiato nel frattempo è un conflitto, non una sovrascrittura", () => {
    const d = add(doc, [correction("Dello sceneggiatore.")]);
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    const edited = applyCommand(d, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Dell'autore." }] });
    expect(revisionConflict(edited, entries(edited)[0]!)).toMatch(/cambiato nel frattempo/);
    expect(() => applyCommand(edited, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT })).toThrow(CommandError);
  });

  it("rifiutare lascia il testo com'è e traccia la decisione", () => {
    const d = add(doc, [correction("No.")]);
    const rejected = applyCommand(d, { type: "revision.reject", chapterId: "ep001", ids: ["r-0001"], by: "autore", at: AT });
    expect(locate(rejected, { panel: null, balloon: balloon.id })!.balloon).toBe(balloon);
    expect(entries(rejected)[0]).toMatchObject({ status: "rejected", resolved_by: "autore" });
  });

  it("aggiungere una battuta crea il balloon con lo speaker, e la voce lo ricorda", () => {
    const d = add(doc, [{ origin: "annotated", kind: "add", panel: talking.id, balloon: null, speaker: "elio", from: null, to: "Aspetta!", source_line: null }]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    const entry = entries(applied)[0]!;
    const created = locate(applied, entry)!.balloon!;
    expect(created.text).toEqual([{ t: "Aspetta!" }]);
    expect(created.speaker.ref).toBe("elio");
  });

  it("changelog e copione si salvano e si riaprono", async () => {
    const store = new MemoryProjectStore();
    const d = applyCommand(add(doc, [correction("X.")]), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    await saveProject(store, d, null);
    expect(store.paths()).toContain("revisions/ep001.json");
    expect(store.paths()).toContain("script/ep001.md");
    const { doc: reopened } = await loadProject(store);
    expect(reopened.revisions).toEqual(d.revisions);
    expect(reopened.scripts.ep001).toBe("# copione\n");
  });

  it("undo annulla testo e stato della voce insieme", async () => {
    const { createHistory, execute, undo } = await import("../src/editor/history.js");
    let h = execute(createHistory(add(doc, [correction("Y.")])), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    h = undo(h);
    expect(entries(h.present)[0]!.status).toBe("open");
    expect(locate(h.present, { panel: null, balloon: balloon.id })!.balloon).toBe(balloon);
  });
});

describe("Lint del changelog (Appendice A, Produzione)", () => {
  it("rev del balloon più vecchia della correzione applicata: avviso", () => {
    const applied = applyCommand(add(doc, [correction("Z.")]), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    expect(lintRevisions(applied)).toEqual([]);
    // Il file di pagina rimesso da un backup: la rev torna indietro, il changelog no.
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    const restored = { ...applied, pages: { ...applied.pages, [pageOf]: doc.pages[pageOf]! } };
    expect(lintRevisions(restored).map((i) => i.code)).toEqual(["production.stale-rev"]);
  });
});
