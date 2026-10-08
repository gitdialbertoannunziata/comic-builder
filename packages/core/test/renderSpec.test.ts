import { describe, expect, it } from "vitest";
import { sampleProject, samplePage } from "../src/fixtures/index.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { compilePanel } from "../src/compile/promptCompiler.js";
import { characterSheetPath, compileCharacterSheetSpec, canonicalJson, compileRenderSpec, renderPaths, renderState, selectReferences, snapRenderSize, specHash } from "../src/compile/renderSpec.js";
import { CharacterSheetSchema, type CharacterSheet } from "../src/schema/characters.js";
import type { Panel, PanelCharacter } from "../src/schema/panel.js";
import { sha1Hex } from "../src/util/sha1.js";

const SHA1_PERCHE = "b8b66660541d651ba615778640a0074b398e7f03";

const layout = samplePage.layout;
if (layout.mode !== "page") throw new Error();
const boxes = resolvePageLayout(layout, samplePage.panels, 1488, 2288, 56, 56);
const base = samplePage.panels[0]!;

const member = (ref: string, role: PanelCharacter["role"]): PanelCharacter => ({ ref, role, weight: 1, framing: "head-and-torso", expression: "", wardrobe: "default" });
const sheet = (id: string, references: Array<{ path: string; use?: boolean }>): CharacterSheet => CharacterSheetSchema.parse({ schema: 1, id, references });
const sheets = {
  sara: sheet("sara", [{ path: "characters/sara/a.png" }, { path: "characters/sara/prova.png", use: false }, { path: "characters/sara/b.png" }]),
  marco: sheet("marco", [{ path: "characters/marco/a.png" }]),
};
const cast: Panel = { ...base, characters: [member("marco", "support"), member("sara", "lead")] };
const spec = (panel: Panel = cast, characters: Record<string, CharacterSheet> = sheets) =>
  compileRenderSpec({
    brief: compilePanel({ project: sampleProject, page: samplePage, panel, panelBox: boxes.get(panel.id)!, targetId: "digital-page", characters }),
    panel,
    characters,
  });

describe("SHA-1 del Core", () => {
  it("coincide coi vettori noti, anche oltre un blocco e con testo non ASCII", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    expect(sha1Hex("perché")).toBe(SHA1_PERCHE);
  });
});

describe("Snap delle dimensioni (§7.4)", () => {
  it("lati multipli di 16, area vicina al megapixel, rapporto del pannello", () => {
    for (const [w, h] of [[700, 500], [300, 900], [1376, 420], [512, 512]] as const) {
      const size = snapRenderSize(w, h);
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
      expect(Math.abs(size.width / size.height / (w / h) - 1)).toBeLessThan(0.04);
      expect(size.width * size.height).toBeGreaterThan(0.85 * 1024 * 1024);
      expect(size.width * size.height).toBeLessThan(1.15 * 1024 * 1024);
    }
  });

  it("un pannello molto allungato resta entro il lato massimo", () => {
    const size = snapRenderSize(4000, 400, 2);
    expect(size.width).toBeLessThanOrEqual(2048);
    expect(size.height).toBeGreaterThanOrEqual(64);
  });
});

describe("Riferimenti dei personaggi (F5)", () => {
  it("solo quelli tenuti per generare, protagonista per primo", () => {
    expect(selectReferences(cast, sheets)).toEqual([
      { character: "sara", path: "characters/sara/a.png" },
      { character: "sara", path: "characters/sara/b.png" },
      { character: "marco", path: "characters/marco/a.png" },
    ]);
  });

  it("con pochi posti si distribuiscono a giro: nessuno resta senza", () => {
    expect(selectReferences(cast, sheets, 2).map((r) => r.character)).toEqual(["sara", "marco"]);
  });

  it("il prompt li nomina per numero, nell'ordine in cui si allegano", () => {
    const { prompt, references } = spec();
    expect(references).toHaveLength(3);
    expect(prompt).toContain("image 1 and image 2 show sara");
    expect(prompt).toContain("image 3 shows marco");
  });
});

describe("RenderSpec (§9.1)", () => {
  it("lo spec, per intero", () => {
    expect(spec()).toMatchSnapshot();
  });

  it("FLUX.2 [pro], senza riscrittura del prompt, e senza i pixel della pagina nel prompt", () => {
    const s = spec();
    expect(s.model).toBe("flux-2-pro");
    expect(s.prompt_upsampling).toBe(false);
    expect(s.prompt).not.toMatch(/\d+×\d+ px\)/);
  });

  it("l'hash non dipende dall'ordine delle chiavi", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    const s = spec();
    expect(specHash(Object.fromEntries(Object.entries(s).reverse()) as typeof s)).toBe(specHash(s));
  });

  it("il file prende nome da pannello, target e hash (§5.7)", () => {
    const s = spec();
    const paths = renderPaths(s);
    expect(paths.image).toBe(`renders/${base.id}@digital-page.${specHash(s).slice(0, 8)}.png`);
    expect(paths.sidecar).toBe(paths.image.replace(/png$/, "json"));
  });

  it("la staleness è calcolata: cambia l'azione, i riferimenti o l'epoca del seed, e il render è vecchio", () => {
    const s = spec();
    const rendered: Panel = { ...cast, render: { "digital-page": { spec_hash: specHash(s), file: renderPaths(s).image, engine: "flux", rendered_at: "2026-10-08T00:00:00Z" } } };
    expect(renderState(cast, s)).toBe("none");
    expect(renderState(rendered, spec(rendered))).toBe("fresh");

    const edited = { ...rendered, action: `${rendered.action} Piove.` };
    expect(renderState(edited, spec(edited))).toBe("stale");
    const variant = { ...rendered, seed: { ...rendered.seed, epoch: rendered.seed.epoch + 1 } };
    expect(renderState(variant, spec(variant))).toBe("stale");
    const curated = { ...sheets, sara: sheet("sara", [{ path: "characters/sara/a.png" }]) };
    expect(renderState(rendered, spec(rendered, curated))).toBe("stale");
  });
});

describe("Scheda personaggio generata (F5)", () => {
  const sara = CharacterSheetSchema.parse({
    schema: 1,
    id: "sara",
    appearance: { age: "woman in her 30s", hair: "short black hair", distinguishing: "scar on left eyebrow" },
    wardrobe: { default: "grey work overalls" },
    palette: "slate grey, rust orange",
  });
  const sheetSpec = (sheet = sara, view: "front" | "three-quarter" | "full-body" = "front") => compileCharacterSheetSpec({ project: sampleProject, sheet, view });

  it("il personaggio da solo, con aspetto, costume e stile del progetto", () => {
    const { prompt, width, height, references } = sheetSpec();
    expect(prompt).toContain("One character only");
    expect(prompt).toContain("front view");
    expect(prompt).toContain("woman in her 30s, short black hair, scar on left eyebrow");
    expect(prompt).toContain("Wearing: grey work overalls.");
    expect([width, height]).toEqual([1024, 1024]);
    expect(references).toEqual([]);
  });

  it("la figura intera è verticale", () => {
    const { width, height } = sheetSpec(sara, "full-body");
    expect(height).toBeGreaterThan(width);
  });

  it("le viste successive guardano quelle già tenute, e solo quelle", () => {
    const withFront = { ...sara, references: [{ path: "characters/sara/front-aaaa.png", note: "", use: true }, { path: "characters/sara/scartata.png", note: "", use: false }] };
    const spec = sheetSpec(withFront, "three-quarter");
    expect(spec.references).toEqual([{ character: "sara", path: "characters/sara/front-aaaa.png" }]);
    expect(spec.prompt).toContain("image 1 shows this same character");
  });

  it("rigenerare una vista dopo averne aggiunta una dà un altro seed, e un altro file", () => {
    const first = sheetSpec();
    const again = sheetSpec({ ...sara, references: [{ path: characterSheetPath(first, "front"), note: "", use: false }] });
    expect(again.seed).not.toBe(first.seed);
    expect(characterSheetPath(first, "front")).toMatch(/^characters\/sara\/front-[0-9a-f]{8}\.png$/);
    expect(characterSheetPath(again, "front")).not.toBe(characterSheetPath(first, "front"));
  });
});
