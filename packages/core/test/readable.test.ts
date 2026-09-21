import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { projectDocFrom, type ProjectDoc } from "../src/document/projectDoc.js";
import { exportReadable, parseAnnotated, normalizeForCompare, refFromName } from "../src/revisions/readable.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "La lanterna" }, pages });
const md = exportReadable(doc, "ep001");
const talking = pages.flatMap((p) => p.panels).find((p) => p.balloons.length > 0)!;
const balloon = talking.balloons[0]!;
const text = balloon.text.map((r) => r.t).join("");
const lineOf = (s: string, id: string) => s.split("\n").find((l) => l.includes(`[${id}]`))!;

describe("Export leggibile (§10.1, passo 2)", () => {
  it("ha gli id stabili di pannelli e battute, il testo e l'azione", () => {
    expect(md).toContain("Capitolo: ep001");
    expect(md).toContain(`### [${talking.id}]`);
    expect(md).toContain(`Azione: ${talking.action}`);
    expect(lineOf(md, balloon.id)).toContain(text);
  });

  it("riletto così com'è, non produce correzioni né avvisi", () => {
    expect(parseAnnotated(doc, "ep001", md)).toEqual({ corrections: [], warnings: [] });
  });
});

describe("Import annotato (§10.1, passo 3)", () => {
  it("una battuta riscritta diventa una correzione di testo, con prima e dopo", () => {
    const edited = md.replace(lineOf(md, balloon.id), `- [${balloon.id}] SARA: Da quanto tempo è spenta?`);
    const { corrections } = parseAnnotated(doc, "ep001", edited);
    expect(corrections).toEqual([
      expect.objectContaining({ kind: "text", balloon: balloon.id, panel: talking.id, from: text, to: "Da quanto tempo è spenta?", origin: "annotated" }),
    ]);
  });

  it("ciò che Word cambia da solo non è una correzione", () => {
    const wordy = md
      .replace(/'/g, "’")
      .replace(/\.\.\./g, "…")
      .replace(/ /g, (m, i) => (i % 7 === 0 ? " " : m))
      .replace(/^- \[/gm, "• [");
    expect(parseAnnotated(doc, "ep001", wordy).corrections).toEqual([]);
  });

  it("[togli] toglie la battuta; una riga cancellata per sbaglio no, e lo si dice", () => {
    const removed = md.replace(lineOf(md, balloon.id), `- [${balloon.id}] SARA: [togli]`);
    expect(parseAnnotated(doc, "ep001", removed).corrections).toEqual([expect.objectContaining({ kind: "remove", balloon: balloon.id })]);

    const deleted = md.replace(`${lineOf(md, balloon.id)}\n`, "");
    const result = parseAnnotated(doc, "ep001", deleted);
    expect(result.corrections).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/non compaiono nel file/);
  });

  it("aggiunte, note e azione riscritta sotto il pannello giusto", () => {
    const annotated = md.replace(
      `Azione: ${talking.action}`,
      `Azione: Sara, di spalle, indica il quadro.\n+ ELIO: Non toccare niente.\n> qui servirebbe un primo piano sulle mani`,
    );
    const { corrections } = parseAnnotated(doc, "ep001", annotated);
    expect(corrections.map((c) => [c.kind, c.panel, c.speaker, c.to])).toEqual([
      ["action", talking.id, null, "Sara, di spalle, indica il quadro."],
      ["add", talking.id, "elio", "Non toccare niente."],
      ["note", talking.id, null, "qui servirebbe un primo piano sulle mani"],
    ]);
  });

  it("un testo con due punti non perde la prima parte («Attento: arriva!» non è un'etichetta)", () => {
    const edited = md.replace(lineOf(md, balloon.id), `- [${balloon.id}] SARA: Attento: arriva!`);
    expect(parseAnnotated(doc, "ep001", edited).corrections[0]!.to).toBe("Attento: arriva!");
  });

  it("id sconosciuti e capitolo sbagliato diventano avvisi", () => {
    const wrong = md.replace("Capitolo: ep001", "Capitolo: ep009") + "\n- [ep001-p001-99-b1] X: ciao\n";
    const { warnings } = parseAnnotated(doc, "ep001", wrong);
    expect(warnings.some((w) => w.includes("ep009"))).toBe(true);
    expect(warnings.some((w) => w.includes("ep001-p001-99-b1"))).toBe(true);
  });

  it("normalizzazioni e ref dai nomi", () => {
    expect(normalizeForCompare("E’ così…  ")).toBe("E' così...");
    expect(refFromName("La Dottoressa")).toBe("la_dottoressa");
    expect(refFromName("Élio")).toBe("elio");
  });
});
