import { describe, expect, it } from "vitest";
import { sampleProject, samplePage } from "../src/fixtures/index.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { compilePanel } from "../src/compile/promptCompiler.js";
import {
  characterSheetPath,
  compileCharacterSheetSpec,
  compileLocationSpec,
  canonicalJson,
  compileRenderSpec,
  locationSheetPath,
  FLUX2_KLEIN_4B,
  maxReferencesFor,
  renderPaths,
  renderState,
  selectReferences,
  snapRenderSize,
  specHash,
} from "../src/compile/renderSpec.js";
import { CharacterSheetSchema, type CharacterSheet } from "../src/schema/characters.js";
import { LocationSheetSchema, type LocationSheet } from "../src/schema/locations.js";
import { SceneSchema } from "../src/schema/scenes.js";
import { STYLE_PRESETS } from "../src/compile/stylePresets.js";
import type { Project } from "../src/schema/project.js";
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

// Uno stile con due tavole (una scartata), un luogo con tre immagini, una scena ambientata lì.
const styled: Pick<Project, "style" | "series_seed"> = {
  series_seed: sampleProject.series_seed,
  style: { preset: "ink-flat", positive: ["scratchy pen hatching", "muted sickly palette"], negative: [], references: [{ path: "style/a.png", note: "", use: true }, { path: "style/scarto.png", note: "", use: false }, { path: "style/b.png", note: "", use: true }, { path: "style/c.png", note: "", use: true }] },
};
const stanza: LocationSheet = LocationSheetSchema.parse({
  schema: 1,
  id: "la_stanza",
  name: "La stanza",
  description: "Small study, red ergonomic chair, desk under a cracked window on the left.",
  references: [{ path: "locations/la_stanza/a.png" }, { path: "locations/la_stanza/b.png" }, { path: "locations/la_stanza/c.png" }],
});
const scene = SceneSchema.parse({ id: "s1", title: "Notifiche", location: "La stanza", time_of_day: "Mattina, dalle 9:00 alle 9:01" });
const placed = (panel: Panel = cast, extra: { locations?: Record<string, LocationSheet>; characters?: Record<string, CharacterSheet> } = {}) =>
  compileRenderSpec({
    brief: compilePanel({ project: { ...sampleProject, ...styled }, page: samplePage, panel, panelBox: boxes.get(panel.id)!, targetId: "digital-page", scene }),
    panel: { ...panel, setting: "La stanza, Mattina, dalle 9:00 alle 9:01" },
    project: styled,
    scene,
    characters: extra.characters ?? sheets,
    locations: extra.locations ?? { la_stanza: stanza },
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
    expect(selectReferences({ panel: cast, characters: sheets })).toEqual([
      { kind: "character", ref: "sara", path: "characters/sara/a.png" },
      { kind: "character", ref: "sara", path: "characters/sara/b.png" },
      { kind: "character", ref: "marco", path: "characters/marco/a.png" },
    ]);
  });

  it("con pochi posti si distribuiscono a giro: nessuno resta senza", () => {
    expect(selectReferences({ panel: cast, characters: sheets, max: 2 }).map((r) => r.ref)).toEqual(["sara", "marco"]);
  });

  it("il prompt li nomina per numero, nell'ordine in cui si allegano", () => {
    const { prompt, references } = spec();
    expect(references).toHaveLength(3);
    expect(prompt).toContain("image 1 and image 2 show sara");
    expect(prompt).toContain("image 3 shows marco");
  });
});

describe("Stile e luogo: uguali in ogni vignetta", () => {
  it("prima lo stile (al massimo due tavole), poi il luogo (due immagini), poi i personaggi", () => {
    const { references } = placed();
    expect(references.map((r) => `${r.kind}:${r.path}`)).toEqual([
      "style:style/a.png",
      "style:style/b.png",
      "location:locations/la_stanza/a.png",
      "location:locations/la_stanza/b.png",
      "character:characters/sara/a.png",
      "character:characters/sara/b.png",
      "character:characters/marco/a.png",
    ]);
  });

  it("una vignetta senza personaggi dà al luogo i loro posti", () => {
    const empty = { ...cast, characters: [] };
    expect(placed(empty).references.filter((r) => r.kind === "location")).toHaveLength(3);
  });

  it("otto posti in tutto: i personaggi prendono quelli che restano, a giro", () => {
    const many = Object.fromEntries(["sara", "marco"].map((id) => [id, sheet(id, [1, 2, 3, 4].map((n) => ({ path: `characters/${id}/${n}.png` })))]));
    const { references } = placed(cast, { characters: many });
    expect(references).toHaveLength(8);
    expect(references.filter((r) => r.kind === "character").map((r) => r.ref)).toEqual(["sara", "sara", "marco", "marco"]);
  });

  it("con quattro posti (FLUX.2 [klein] in locale) stile e luogo ne prendono uno a testa, e i personaggi non restano senza", () => {
    expect(maxReferencesFor(FLUX2_KLEIN_4B)).toBe(4);
    expect(maxReferencesFor("flux-2-pro")).toBe(8);
    const local = compileRenderSpec({
      brief: compilePanel({ project: { ...sampleProject, ...styled }, page: samplePage, panel: cast, panelBox: boxes.get(cast.id)!, targetId: "digital-page", scene }),
      panel: cast,
      project: styled,
      scene,
      characters: sheets,
      locations: { la_stanza: stanza },
      model: FLUX2_KLEIN_4B,
    });
    expect(local.references.map((r) => `${r.kind}:${r.ref}`)).toEqual(["style:style", "location:la_stanza", "character:sara", "character:marco"]);
    expect(placed({ ...cast, characters: [] }).references.length).toBeLessThanOrEqual(8);
    const sheet = compileCharacterSheetSpec({ project: styled, sheet: sheets.sara, view: "front", model: FLUX2_KLEIN_4B });
    expect(sheet.references.map((r) => r.kind)).toEqual(["style", "character", "character"]);
  });

  it("stile e luogo in testa al prompt, con le immagini nominate per ciò che danno", () => {
    const lines = placed().prompt.split("\n");
    expect(lines[0]).toMatch(/^Wordless comic panel/);
    expect(lines[1]).toBe("Art style (identical in every panel of this comic): scratchy pen hatching, muted sickly palette.");
    expect(lines[2]).toMatch(/^image 1 and image 2 are style references: draw in exactly that art style/);
    expect(lines[3]).toBe(
      "Location (the same place in every panel set here): La stanza — Small study, red ergonomic chair, desk under a cracked window on the left. Time: Mattina, dalle 9:00 alle 9:01.",
    );
    expect(lines[4]).toMatch(/^image 3 and image 4 show this same place/);
    expect(placed().prompt).toContain("image 5 and image 6 show sara");
    expect(placed().prompt).toContain("image 7 shows marco");
  });

  it("la riga dello stile e quella del luogo sono identiche in due vignette diverse della scena", () => {
    const other = samplePage.panels[1]!;
    const head = (p: Panel) => placed(p).prompt.split("\n").filter((l) => l.startsWith("Art style") || l.startsWith("Location"));
    expect(head({ ...other, characters: [] })).toEqual(head(cast));
  });

  it("il campo «luogo e ora» che ripete la scena non si ripete; uno che aggiunge qualcosa sì", () => {
    expect(placed().prompt).not.toContain("In this panel:");
    const night = compileRenderSpec({
      brief: compilePanel({ project: sampleProject, page: samplePage, panel: cast, panelBox: boxes.get(cast.id)!, targetId: "digital-page", scene }),
      panel: { ...cast, setting: "La stanza vista dal corridoio" },
      project: styled,
      scene,
      locations: { la_stanza: stanza },
    });
    expect(night.prompt).toContain("In this panel: La stanza vista dal corridoio.");
  });

  it("niente negazioni: il prompt non nomina balloon, testo né cornici; la zona del balloon è sfondo vuoto", () => {
    const box = boxes.get(cast.id)!;
    const { prompt } = compileRenderSpec({
      brief: compilePanel({ project: sampleProject, page: samplePage, panel: cast, panelBox: box, targetId: "digital-page", balloonBoxes: [{ id: "b1", box: { x: box.x + 10, y: box.y + 10, width: 200, height: 80 } }] }),
      panel: cast,
      project: styled,
    });
    expect(prompt).not.toMatch(/balloon|caption|lettering|border|\bno text\b|Avoid:/i);
    expect(prompt).toMatch(/Keep the top left of the picture \(x \d+–\d+%, y \d+–\d+%\) calm and empty, just plain background/);
  });

  it("senza uno stile scritto vale il preset del progetto: mai una vignetta senza stile", () => {
    const { prompt } = spec();
    expect(prompt).toContain(`Art style (identical in every panel of this comic): ${STYLE_PRESETS[0]!.positive}.`);
  });

  it("niente scheda del luogo: il nome e l'ora, e nessuna immagine del luogo", () => {
    const { prompt, references } = placed(cast, { locations: {} });
    expect(prompt).toContain("Location (the same place in every panel set here): La stanza. Time:");
    expect(references.some((r) => r.kind === "location")).toBe(false);
  });

  it("cambiare la descrizione del luogo o una tavola di stile rende vecchio il render", () => {
    const before = placed();
    const after = placed(cast, { locations: { la_stanza: { ...stanza, description: "Bigger room." } } });
    expect(specHash(after)).not.toBe(specHash(before));
  });
});

describe("Tavola di un luogo", () => {
  const plate = (location: LocationSheet = { ...stanza, references: [] }) => compileLocationSpec({ project: styled, location });

  it("il luogo vuoto, largo, nello stile dell'opera e con le sue tavole", () => {
    const s = plate();
    expect(s.prompt).toMatch(/^Establishing view of a place for a comic: the location alone, with nobody in it\./);
    expect(s.prompt).toContain("Location: La stanza — Small study, red ergonomic chair");
    expect(s.references.map((r) => r.kind)).toEqual(["style", "style"]);
    expect([s.width, s.height]).toEqual([1216, 832]);
    expect(locationSheetPath(s)).toMatch(/^locations\/la_stanza\/plate-[0-9a-f]{8}\.png$/);
  });

  it("una seconda tavola guarda la prima: lo stesso posto da un altro punto di vista", () => {
    const s = plate({ ...stanza, references: [{ path: "locations/la_stanza/a.png", note: "", use: true }] });
    expect(s.references.at(-1)).toEqual({ kind: "location", ref: "la_stanza", path: "locations/la_stanza/a.png" });
    expect(s.prompt).toContain("image 3 shows this same place");
    expect(s.seed).not.toBe(plate().seed);
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
    expect(prompt).toContain("one character alone");
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
    expect(spec.references).toEqual([{ kind: "character", ref: "sara", path: "characters/sara/front-aaaa.png" }]);
    expect(spec.prompt).toContain("image 1 shows this same character");
  });

  it("le tavole di stile vengono prima: la scheda nasce nello stile dell'opera", () => {
    const withFront = { ...sara, references: [{ path: "characters/sara/front-aaaa.png", note: "", use: true }] };
    const s = compileCharacterSheetSpec({ project: styled, sheet: withFront, view: "three-quarter" });
    expect(s.references.map((r) => r.kind)).toEqual(["style", "style", "character"]);
    expect(s.prompt).toContain("image 1 and image 2 are style references");
    expect(s.prompt).toContain("image 3 shows this same character");
  });

  it("rigenerare una vista dopo averne aggiunta una dà un altro seed, e un altro file", () => {
    const first = sheetSpec();
    const again = sheetSpec({ ...sara, references: [{ path: characterSheetPath(first, "front"), note: "", use: false }] });
    expect(again.seed).not.toBe(first.seed);
    expect(characterSheetPath(first, "front")).toMatch(/^characters\/sara\/front-[0-9a-f]{8}\.png$/);
    expect(characterSheetPath(again, "front")).not.toBe(characterSheetPath(first, "front"));
  });
});
