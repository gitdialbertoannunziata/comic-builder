import { describe, expect, it } from "vitest";
import { sampleProject, samplePage } from "../src/fixtures/index.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { compilePageBrief, compilePanel, panelSeed } from "../src/compile/promptCompiler.js";
import type { Panel } from "../src/schema/panel.js";

const layout = samplePage.layout;
if (layout.mode !== "page") throw new Error();
const boxes = resolvePageLayout(layout, samplePage.panels, 1488, 2288, 56, 56);
const talking = samplePage.panels.find((p) => p.balloons.length > 0)!;
const box = boxes.get(talking.id)!;
const balloonBoxes = talking.balloons.map((b) => ({ id: b.id, box: { x: box.x + b.anchor.x * box.width, y: box.y + b.anchor.y * box.height, width: 300, height: 90 } }));
const compile = (panel: Panel = talking) =>
  compilePanel({ project: sampleProject, page: samplePage, panel, panelBox: boxes.get(panel.id)!, balloonBoxes: panel === talking ? balloonBoxes : [], targetId: "digital-page" });

describe("Compilatore pannello → istruzioni (§9.1)", () => {
  it("il brief, per intero", () => {
    expect(compile().brief).toMatchSnapshot();
  });

  it("i frammenti della camera vengono dalla tabella §6.1", () => {
    const { positive } = compile({ ...talking, camera: { ...talking.camera, shot: "MS", angle: "low", lens_mm: 24 } });
    expect(positive).toContain("medium shot, waist up");
    expect(positive).toContain("low angle looking up, imposing");
    expect(positive).toContain("24mm wide lens");
  });

  it("mood e asse di scena non entrano nel prompt (§6.1); il tono entra nel brief", () => {
    const tense = compile({ ...talking, camera: { ...talking.camera, mood: "dread", axis_side: "A-right" } });
    expect(tense.positive).not.toMatch(/dread|A-right|axis/i);
    expect(tense.brief).toMatch(/Tone .*dread/);
    expect(tense.brief).not.toContain("A-right");
  });

  it("le zone dei balloon diventano aree da lasciare libere, in percentuale del pannello", () => {
    const { reservedZones, brief } = compile();
    expect(reservedZones).toHaveLength(talking.balloons.length);
    for (const z of reservedZones) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.width).toBeLessThanOrEqual(1.001);
    }
    expect(brief).toMatch(/free of important detail .* a speech balloon goes there/);
  });

  it("nel prompt compatto la punteggiatura finale delle frasi dell'autore non produce «.,»", () => {
    const { positive } = compile({ ...talking, action: "Sara risponde dalla porta." });
    expect(positive).toContain("Sara risponde dalla porta, ");
    expect(positive).not.toContain(".,");
  });

  it("il modello non deve scrivere: niente testo né balloon, sempre nel negativo", () => {
    expect(compile().negative).toMatch(/^text, lettering, speech balloons/);
  });

  it("precedenza: prompt.override sostituisce il prompt compilato, e lo si dichiara", () => {
    const overridden = compile({ ...talking, prompt: { override: "a lighthouse at dawn, ink", negative_override: "color" } });
    expect(overridden.positive).toBe("a lighthouse at dawn, ink");
    expect(overridden.negative).toBe("color");
    expect(overridden.overridden).toBe(true);
    expect(overridden.brief).toContain("Author's prompt for this panel");
  });

  it("seed: stabile, derivato dal seed di serie, cambia con l'epoca, override se dichiarato", () => {
    expect(panelSeed(sampleProject, talking)).toBe(panelSeed(sampleProject, talking));
    expect(panelSeed(sampleProject, { ...talking, seed: { ...talking.seed, epoch: 1 } })).not.toBe(panelSeed(sampleProject, talking));
    expect(panelSeed({ series_seed: 1 }, talking)).not.toBe(panelSeed(sampleProject, talking));
    expect(panelSeed(sampleProject, { ...talking, seed: { mode: "override", value: 42, epoch: 0 } })).toBe(42);
  });

  it("proporzioni: rapporto nominale e bucket SDXL più vicini (§7.4)", () => {
    const wide = compilePanel({ project: sampleProject, page: samplePage, panel: talking, panelBox: { x: 0, y: 0, width: 1600, height: 900 }, targetId: "t" });
    expect(wide.aspect).toBe("16:9");
    expect(wide.sdxl).toEqual({ width: 1344, height: 768 });
    const tall = compilePanel({ project: sampleProject, page: samplePage, panel: talking, panelBox: { x: 0, y: 0, width: 600, height: 900 }, targetId: "t" });
    expect(tall.aspect).toBe("2:3");
    expect(tall.sdxl).toEqual({ width: 832, height: 1216 });
  });

  it("un pannello senza personaggi lo dice, invece di lasciar inventare il modello", () => {
    expect(compile({ ...talking, characters: [], balloons: [] }).brief).toContain("No characters in frame.");
  });

  it("stesso documento, stesso testo", () => {
    expect(compile()).toEqual(compile());
  });

  it("il brief di pagina: griglia in ordine di lettura, poi ogni pannello", () => {
    const panels = layout.reading_order.map((id) => compile(samplePage.panels.find((p) => p.id === id)!));
    const page = compilePageBrief({ page: samplePage, pageBox: { x: 0, y: 0, width: 1600, height: 2400 }, panels, boxes, readingDirection: "rtl" });
    expect(page).toContain(`${panels.length} panels, read right to left`);
    expect(page.indexOf(`Panel 1 (${layout.reading_order[0]})`)).toBeLessThan(page.indexOf(`Panel 2 (${layout.reading_order[1]})`));
  });
});
