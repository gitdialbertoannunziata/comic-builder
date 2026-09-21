import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { SceneSchema } from "../src/schema/scenes.js";
import { applyCommand } from "../src/editor/commands.js";
import { diffLines, lineMap, scriptImpact } from "../src/revisions/scriptDiff.js";

const OLD = [
  "# Il faro", //                          1
  "", //                                   2
  "Il faro sulla scogliera, all'alba.", // 3  beat 1
  "", //                                   4
  "SARA: È spenta da quanto?", //          5  beat 2
  "ELIO: Dalle due.", //                   6
  "", //                                   7
  "Elio mostra il quadro elettrico.", //   8  beat 3
  "",
].join("\n");

const source = (from: number, to: number) => ({ file: "script/ep001.md", from_line: from, to_line: to });
const scene = SceneSchema.parse({
  id: "s001",
  title: "Il faro",
  location: "scogliera",
  time_of_day: "alba",
  characters: ["sara", "elio"],
  beats: [
    { id: "s001-b1", function: "establish", summary: "Il faro sulla scogliera.", source: source(3, 3) },
    {
      id: "s001-b2",
      function: "dialogue",
      summary: "Parlano.",
      source: source(5, 6),
      lines: [
        { speaker: "sara", text: "È spenta da quanto?" },
        { speaker: "elio", text: "Dalle due." },
      ],
    },
    { id: "s001-b3", function: "action", summary: "Il quadro.", source: source(8, 8) },
  ],
});
const pages = buildPagesFromScene({ scene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [scene], chapter: { id: "ep001", number: 1, title: "t" }, pages, script: OLD });
const panels = pages.flatMap((p) => p.panels);
const dialoguePanel = panels.find((p) => p.balloons.length > 0)!;

describe("Diff per righe", () => {
  it("trova le parti cambiate, con numeri di riga da 1", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\n")).toEqual([{ oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 }]);
    expect(diffLines("a\nc\n", "a\nb\nc\n")).toEqual([{ oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 3 }]);
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("la mappa delle righe segue gli spostamenti", () => {
    const map = lineMap("a\nb\nc\n", "x\ny\na\nb\nc\n");
    expect([1, 2, 3].map(map)).toEqual([3, 4, 5]);
  });
});

describe("Impatto di una nuova versione del copione (§10.1, passo 1)", () => {
  const NEW = OLD.replace("ELIO: Dalle due.", "ELIO: Dalle due, più o meno.\nSARA: E nessuno ha visto niente?")
    .replace("Il faro sulla scogliera, all'alba.", "Il faro sulla scogliera, nella nebbia dell'alba.")
    .concat("\nArriva una barca.\n");
  const impact = scriptImpact(doc, "ep001", NEW);

  it("dice quali pannelli sono toccati, e solo quelli", () => {
    const touched = impact.touched.map((t) => t.panel.id);
    expect(touched).toContain(dialoguePanel.id);
    expect(touched).toHaveLength(2); // l'apertura (prosa cambiata) e il dialogo
    expect(touched).not.toContain(panels.find((p) => p.source?.from_line === 8)!.id);
  });

  it("una battuta cambiata diventa una correzione di testo sul balloon giusto", () => {
    const elio = dialoguePanel.balloons.find((b) => b.speaker.ref === "elio")!;
    expect(impact.corrections).toContainEqual(expect.objectContaining({ kind: "text", balloon: elio.id, from: "Dalle due.", to: "Dalle due, più o meno.", origin: "script" }));
  });

  it("una battuta nuova nel pannello diventa un'aggiunta, con chi la dice", () => {
    expect(impact.corrections).toContainEqual(expect.objectContaining({ kind: "add", panel: dialoguePanel.id, speaker: "sara", to: "E nessuno ha visto niente?" }));
  });

  it("la prosa cambiata diventa una nota, non una riscrittura automatica dell'azione", () => {
    const opening = panels.find((p) => p.source?.from_line === 3)!;
    expect(impact.corrections).toContainEqual(expect.objectContaining({ kind: "note", panel: opening.id, to: "Il faro sulla scogliera, nella nebbia dell'alba." }));
    expect(impact.corrections.some((c) => c.kind === "action")).toBe(false);
  });

  it("materiale nuovo fuori da ogni pannello resta da impaginare, e lo si dice", () => {
    expect(impact.unassigned).toHaveLength(1);
  });

  it("una battuta aggiunta subito dopo l'ultima riga di un blocco va al pannello di quel blocco", () => {
    const appended = OLD.replace("ELIO: Dalle due.", "ELIO: Dalle due.\nSARA: E nessuno ha visto niente?");
    const result = scriptImpact(doc, "ep001", appended);
    expect(result.unassigned).toEqual([]);
    expect(result.corrections).toEqual([expect.objectContaining({ kind: "add", panel: dialoguePanel.id, speaker: "sara", to: "E nessuno ha visto niente?" })]);
  });

  it("nessuna correzione duplicata", () => {
    const keys = impact.corrections.map((c) => JSON.stringify([c.kind, c.panel, c.balloon, c.to]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("le correzioni si applicano, e il copione nuovo riallinea la provenienza", () => {
    let next = applyCommand(doc, { type: "revision.add", chapterId: "ep001", entries: impact.corrections, by: "sceneggiatore", at: "2026-09-22T10:00:00Z" });
    const ids = next.revisions.ep001!.entries.filter((e) => e.kind !== "note").map((e) => e.id);
    next = applyCommand(next, { type: "revision.apply", chapterId: "ep001", ids, by: "autore", at: "2026-09-22T10:05:00Z" });
    next = applyCommand(next, { type: "script.set", chapterId: "ep001", text: NEW, sha: "abc" });

    // Dopo, lo stesso copione non produce più correzioni di testo: è allineato.
    const again = scriptImpact(next, "ep001", NEW);
    expect(again.hunks).toEqual([]);
    const closing = next.pages[pages.at(-1)!.id]!.panels.find((p) => p.source && p.source.from_line >= 8)!;
    expect(closing.source!.from_line).toBe(9); // una riga in più sopra
    expect(next.revisions.ep001!.script).toEqual({ file: "script/ep001.md", sha: "abc" });
    expect(next.scenes.scenes[0]!.beats[2]!.source!.from_line).toBe(9);
  });
});
