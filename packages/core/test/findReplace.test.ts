import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { findMatches, findPattern } from "../src/revisions/findReplace.js";
import { characterRefs } from "../src/editor/renameCharacter.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages });
const AT = "2026-09-22T10:00:00Z";
const allText = () => pages.flatMap((p) => p.panels.flatMap((x) => x.balloons.map((b) => b.text.map((r) => r.t).join(""))));
const someWord = allText().join(" ").match(/\p{L}{4,}/u)![0];

describe("Trova e sostituisci (§10.3)", () => {
  it("parola intera con lettere accentate: «è» non spezza una parola", () => {
    const p = findPattern("spenta", { wholeWord: true })!;
    expect("È spenta da quanto?".match(p)).toHaveLength(1);
    expect("spentaè".match(p)).toBeNull();
    expect("Spenta".match(findPattern("spenta", { matchCase: true })!)).toBeNull();
  });

  it("il testo sostitutivo è testo, non un modello: «$1» resta «$1»", () => {
    const [m] = findMatches(doc, "ep001", someWord, "$1", { matchCase: true });
    expect(m!.after).toContain("$1");
  });

  it("ogni battuta cambiata entra nel changelog come correzione applicata, con rev allineata", () => {
    const next = applyCommand(doc, { type: "text.replace", chapterId: "ep001", find: someWord, replace: "XYZ", options: { matchCase: true }, by: "autore", at: AT });
    const entries = next.revisions.ep001!.entries;
    const matches = findMatches(doc, "ep001", someWord, "XYZ", { matchCase: true });
    expect(entries).toHaveLength(matches.length);
    expect(entries.every((e) => e.status === "applied" && e.origin === "find-replace" && e.rev !== null)).toBe(true);
    // Solo le pagine con occorrenze, più il changelog, vanno riscritte.
    const touchedPages = new Set(matches.map((m) => `pages/${m.pageId}.json`));
    expect(changedFiles(next, doc).writes.map((w) => w.path).sort()).toEqual([...touchedPages, "revisions/ep001.json"].sort());
  });

  it("nessuna occorrenza: lo si dice", () => {
    expect(() => applyCommand(doc, { type: "text.replace", chapterId: "ep001", find: "zzzqqq", replace: "a", options: {}, by: "a", at: AT })).toThrow(CommandError);
  });

  it("anche l'azione dei pannelli, se richiesto", () => {
    const action = pages[0]!.panels[0]!.action;
    const word = action.match(/\p{L}{4,}/u)![0];
    const both = findMatches(doc, "ep001", word, "X", { scope: "actions", matchCase: true });
    expect(both.some((m) => m.balloonId === null)).toBe(true);
    expect(both.every((m) => m.balloonId === null)).toBe(true);
  });
});

describe("Rinomina di un personaggio (§10.3)", () => {
  it("cambia chi parla, chi è in vignetta e il cast di scene e beat, in tutto il progetto", () => {
    expect(characterRefs(doc).has("elio")).toBe(true);
    const next = applyCommand(doc, { type: "character.rename", from: "elio", to: "Marco" });
    const refs = characterRefs(next);
    expect(refs.has("elio")).toBe(false);
    expect(refs.has("marco")).toBe(true);
    expect(next.scenes.scenes[0]!.characters).toContain("marco");
    expect(next.scenes.scenes[0]!.beats.flatMap((b) => b.lines.map((l) => l.speaker))).not.toContain("elio");
  });

  it("le pagine senza quel personaggio non si riscrivono", () => {
    const next = applyCommand(doc, { type: "character.rename", from: "elio", to: "marco" });
    for (const [id, page] of Object.entries(doc.pages)) {
      const mentions = page.panels.some((p) => p.characters.some((c) => c.ref === "elio") || p.balloons.some((b) => b.speaker.ref === "elio"));
      if (!mentions) expect(next.pages[id]).toBe(page);
    }
  });

  it("rifiuta un nome già usato (unire due personaggi è un'altra cosa) e un personaggio inesistente", () => {
    expect(() => applyCommand(doc, { type: "character.rename", from: "elio", to: "Sara" })).toThrow(/Esiste già/);
    expect(() => applyCommand(doc, { type: "character.rename", from: "nessuno", to: "x" })).toThrow(/Nessun personaggio/);
  });
});
