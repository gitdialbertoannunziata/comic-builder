import type { CharacterSheet } from "../schema/characters.js";
import type { LocationSheet } from "../schema/locations.js";
import type { Panel } from "../schema/panel.js";
import type { Scene } from "../schema/scenes.js";
import { sha1Hex } from "../util/sha1.js";
import type { Project } from "../schema/project.js";
import { ANGLE_FRAGMENT, DOF_FRAGMENT, FRAMING_FRAGMENT, LENS_FRAGMENT, LIGHTING_FRAGMENT, MOOD_GUIDANCE, MOTION_FRAGMENT, PLACEMENT_FRAGMENT, SHOT_FRAGMENT } from "./fragments.js";
import { appearanceText, fragment, hash32, panelPlace, placeLine, wardrobeText, type PanelBrief } from "./promptCompiler.js";
import { styleText } from "./stylePresets.js";

/**
 * RenderSpec (§9.1): tutto ciò che decide un'immagine generata, e nient'altro.
 *
 * È l'unità di cache e di staleness (§5.7): l'hash dello spec dà il nome al
 * file in `renders/`, e un pannello è da rigenerare quando lo spec che il
 * documento compila oggi non è più quello che ha prodotto l'immagine.
 *
 * La forma segue il modello scelto per il ramo AI, FLUX.2: un prompt in
 * chiaro e fino a otto immagini di riferimento. Non ha prompt negativo,
 * sampler, passi né cfg, e non carica LoRA: la coerenza passa dai
 * riferimenti curati — dello stile, del luogo, dei personaggi — che il
 * prompt nomina per numero.
 */
export interface RenderSpec {
  panel: string;
  target: string;
  /** Dimensioni chieste al modello: il rapporto del pannello, agganciato a ciò che il modello accetta. */
  width: number;
  height: number;
  aspect: string;
  prompt: string;
  seed: number;
  model: string;
  /** Sempre spenta: un prompt riscritto dal fornitore non è riproducibile, e non è quello registrato qui. */
  prompt_upsampling: false;
  output_format: "png";
  /** Nell'ordine in cui si allegano: il prompt li chiama «image 1», «image 2»… */
  references: RenderReference[];
  control_image: string | null;
  /** Versione del compilatore: alzarla invalida i render quando cambia *come* si compila, non cosa. */
  compiler: number;
}

/** Di cosa è riferimento un'immagine: il prompt dice al modello cosa prenderne. */
export type ReferenceKind = "style" | "location" | "character";

export interface RenderReference {
  kind: ReferenceKind;
  /** Il ref del personaggio o del luogo; per lo stile, `style`. */
  ref: string;
  path: string;
}

/**
 * 2: stile e luogo in testa al prompt, riferimenti di stile e di luogo,
 * niente negazioni (FLUX.2 disegna ciò che si nomina, anche per escluderlo).
 */
export const RENDER_COMPILER_VERSION = 2;
export const RENDERS_DIR = "renders";
export const FLUX2_PRO = "flux-2-pro";
/** FLUX.2 [flex]: stesso spec e stessi riferimenti di [pro]. Passi e guidance non si mandano: valgono quelli del fornitore. */
export const FLUX2_FLEX = "flux-2-flex";
/** `input_image` … `input_image_8` nell'API di FLUX.2. */
export const FLUX2_MAX_REFERENCES = 8;
/** Tavole di stile per immagine: due bastano a definire un segno, e i posti servono ai personaggi. */
export const MAX_STYLE_REFERENCES = 2;
/** Immagini del luogo per vignetta; quattro se in vignetta non c'è nessuno, e il luogo è tutto. */
export const MAX_LOCATION_REFERENCES = 2;

const MEGAPIXEL = 1024 * 1024;

/**
 * Snap delle dimensioni (§7.4): stesso rapporto del pannello, area vicina a
 * quella chiesta, lati multipli di 16 come vuole il modello. Un pannello
 * molto allungato perde area invece di sforare il lato massimo.
 */
export function snapRenderSize(width: number, height: number, megapixels = 1): { width: number; height: number } {
  const MULTIPLE = 16;
  const MIN = 64;
  const MAX = 2048;
  const ratio = width / height;
  const snap = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v / MULTIPLE) * MULTIPLE));
  let h = Math.sqrt((megapixels * MEGAPIXEL) / ratio);
  let w = h * ratio;
  const over = Math.max(w, h) / MAX;
  if (over > 1) {
    w /= over;
    h /= over;
  }
  return { width: snap(w), height: snap(h) };
}

const ROLE_ORDER = { lead: 0, support: 1, background: 2 } as const;

const used = (list: ReadonlyArray<{ path: string; use: boolean }> | undefined) => (list ?? []).filter((r) => r.use).map((r) => r.path);

export interface SelectReferencesInput {
  panel: Pick<Panel, "characters">;
  characters?: Readonly<Record<string, CharacterSheet>>;
  style?: Pick<Project["style"], "references">;
  location?: LocationSheet | null;
  max?: number;
}

/**
 * Quali riferimenti allegare, e in che ordine. I posti sono otto:
 *
 * 1. le tavole di stile (al massimo due), in ogni vignetta: è ciò che tiene
 *    lo stesso segno da una all'altra;
 * 2. le immagini del luogo (due, quattro se in vignetta non c'è nessuno):
 *    è ciò che tiene la stanza la stessa stanza;
 * 3. i personaggi, coi posti che restano, a giro e protagonista per primo:
 *    con tre personaggi nessuno resta senza mentre un altro ne ha quattro.
 *
 * Solo le immagini spuntate «per generare»: la curatela è dell'autore.
 */
export function selectReferences(input: SelectReferencesInput): RenderReference[] {
  const max = input.max ?? FLUX2_MAX_REFERENCES;
  const picked: RenderReference[] = [];
  for (const path of used(input.style?.references).slice(0, Math.min(MAX_STYLE_REFERENCES, max))) picked.push({ kind: "style", ref: "style", path });
  const locationSlots = input.panel.characters.length === 0 ? MAX_LOCATION_REFERENCES * 2 : MAX_LOCATION_REFERENCES;
  if (input.location) {
    for (const path of used(input.location.references).slice(0, Math.min(locationSlots, max - picked.length))) picked.push({ kind: "location", ref: input.location.id, path });
  }

  const sheets = input.characters ?? {};
  const cast = [...input.panel.characters]
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.weight - a.weight)
    .map((c) => ({ ref: c.ref, paths: used(sheets[c.ref]?.references) }));
  const people: RenderReference[] = [];
  for (let round = 0; picked.length + people.length < max; round++) {
    let any = false;
    for (const { ref, paths } of cast) {
      const path = paths[round];
      if (path === undefined || picked.length + people.length >= max) continue;
      people.push({ kind: "character", ref, path });
      any = true;
    }
    if (!any) break;
  }
  // Raggruppati per personaggio: «image 3 and image 4 show sara» si legge meglio di numeri sparsi.
  const order = new Map(cast.map((c, i) => [c.ref, i]));
  people.sort((a, b) => order.get(a.ref)! - order.get(b.ref)!);
  return [...picked, ...people];
}

/** «image 1», «image 1 and image 2», «images 1, 2 and 3». */
function imageNames(indexes: readonly number[]): string {
  if (indexes.length <= 2) return indexes.map((n) => `image ${n}`).join(" and ");
  return `images ${indexes.slice(0, -1).join(", ")} and ${indexes[indexes.length - 1]}`;
}

function indexesOf(references: readonly RenderReference[], kind: ReferenceKind, ref?: string): number[] {
  return references.flatMap((r, i) => (r.kind === kind && (ref === undefined || r.ref === ref) ? [i + 1] : []));
}

/** Le righe dello stile: lo stesso testo in ogni immagine dell'opera, e le tavole che lo mostrano. */
function styleLines(project: Pick<Project, "style">, references: readonly RenderReference[]): string[] {
  const lines = [`Art style (identical in every panel of this comic): ${styleText(project.style)}.`];
  const style = indexesOf(references, "style");
  if (style.length > 0) {
    lines.push(
      `${imageNames(style)} ${style.length > 1 ? "are style references" : "is a style reference"}: draw in exactly that art style — the same line work, inking, colouring, shading and texture. Take only the style from ${style.length > 1 ? "them" : "it"}, not ${style.length > 1 ? "their" : "its"} subjects or composition.`,
    );
  }
  return lines;
}

/** Dove sta una zona da lasciare libera, a parole: «top left». */
function where(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const vertical = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : "middle";
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "center";
  return vertical === "middle" && horizontal === "center" ? "center" : `${vertical} ${horizontal}`;
}

const pct = (v: number) => Math.round(v * 100);

export interface CompileRenderSpecInput {
  brief: PanelBrief;
  panel: Panel;
  /** Lo stile dell'opera. Senza, vale il preset di partenza: mai una vignetta senza stile. */
  project?: Pick<Project, "style">;
  /** La scena del pannello: dice il luogo e l'ora. */
  scene?: Scene;
  characters?: Readonly<Record<string, CharacterSheet>>;
  locations?: Readonly<Record<string, LocationSheet>>;
  model?: string;
  megapixels?: number;
  maxReferences?: number;
}

/**
 * Il prompt di una vignetta per FLUX.2. Tre regole, tutte imparate guardando
 * capitoli generati:
 *
 * - **stile e luogo prima di tutto, uguali parola per parola** in ogni
 *   vignetta: è la parte che deve uscire uguale, e il modello pesa di più
 *   ciò che legge per primo;
 * - **i riferimenti si nominano per ciò che danno**: dalla tavola di stile il
 *   segno, dal luogo la pianta e gli arredi, dal personaggio la faccia —
 *   mai la composizione;
 * - **niente negazioni**: FLUX.2 non ha un prompt negativo, e «no speech
 *   balloons, no panel border» gli fa disegnare balloon e cornici. Si chiede
 *   un'immagine «senza parole, al vivo», e le zone dei balloon si descrivono
 *   come sfondo vuoto, senza dire perché.
 */
function panelPrompt(input: CompileRenderSpecInput, references: readonly RenderReference[], place: ReturnType<typeof panelPlace>): string {
  const { brief, panel } = input;
  const cam = panel.camera;
  const sheets = input.characters ?? {};
  const lines = [
    `Wordless comic panel: a single illustration that fills the whole frame edge to edge, aspect ${brief.aspect}.`,
    ...styleLines(input.project ?? { style: { preset: "", positive: [], negative: [], references: [] } }, references),
  ];

  if (place) {
    lines.push(placeLine(place));
    const shown = place.ref ? indexesOf(references, "location", place.ref) : [];
    if (shown.length > 0) lines.push(`${imageNames(shown)} ${shown.length > 1 ? "show" : "shows"} this same place: keep its layout, architecture, furniture, materials and colours, seen from this panel's camera.`);
  }

  lines.push(`Framing: ${[SHOT_FRAGMENT[cam.shot], ANGLE_FRAGMENT[cam.angle], LENS_FRAGMENT[cam.lens_mm], DOF_FRAGMENT[cam.dof]].filter(Boolean).join("; ")}.`);

  if (panel.characters.length === 0) lines.push("Nobody in the frame.");
  else {
    lines.push("Characters (each one looks the same in every panel):");
    for (const c of [...panel.characters].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.weight - a.weight)) {
      const sheet = sheets[c.ref];
      const wearing = wardrobeText(sheet, c.wardrobe);
      const head = `- ${c.ref}${sheet?.name ? ` «${sheet.name}»` : ""} (${[c.role, FRAMING_FRAGMENT[c.framing], c.expression ? `expression: ${fragment(c.expression)}` : null].filter(Boolean).join("; ")})`;
      const look = [sheet ? appearanceText(sheet) || null : null, wearing ? `wearing ${fragment(wearing)}` : null, sheet?.palette ? `colours: ${fragment(sheet.palette)}` : null].filter(Boolean);
      const shown = indexesOf(references, "character", c.ref);
      const same = shown.length > 0 ? ` ${imageNames(shown)} ${shown.length > 1 ? "show" : "shows"} ${c.ref}: the same face, hair, build and clothes.` : "";
      lines.push(`${head}${look.length > 0 ? `: ${look.join("; ")}.` : "."}${same}`);
    }
  }

  if (PLACEMENT_FRAGMENT[cam.subject_placement]) lines.push(`Composition: ${PLACEMENT_FRAGMENT[cam.subject_placement]}.`);
  if (panel.action) lines.push(`Action: ${fragment(panel.action)}.`);
  if (panel.props.length > 0) lines.push(`${cam.shot === "INSERT" ? "Focus on" : "Props"}: ${panel.props.map(fragment).join(", ")}.`);
  lines.push(`Lighting: ${LIGHTING_FRAGMENT[cam.lighting]}.`);
  if (MOTION_FRAGMENT[cam.motion]) lines.push(`Motion: ${MOTION_FRAGMENT[cam.motion]}.`);
  lines.push(`Mood (composition and staging; the colours stay those of the art style): ${MOOD_GUIDANCE[cam.mood]}.`);
  if (panel.continuity_notes) lines.push(`Continuity: ${fragment(panel.continuity_notes)}.`);
  for (const zone of brief.reservedZones) {
    lines.push(
      `Keep the ${where(zone.x, zone.y, zone.width, zone.height)} of the picture (x ${pct(zone.x)}–${pct(zone.x + zone.width)}%, y ${pct(zone.y)}–${pct(zone.y + zone.height)}%) calm and empty, just plain background such as wall, sky, floor or shadow.`,
    );
  }
  // Solo ciò che l'autore ha chiesto di evitare: la lista di base (testo, balloon, cornici) nominerebbe proprio ciò che si vuole fuori.
  const avoid = (input.project?.style.negative ?? []).map(fragment).filter(Boolean);
  if (avoid.length > 0) lines.push(`Avoid: ${avoid.join(", ")}.`);
  if (brief.overridden) lines.push(`Author's prompt for this panel (takes precedence): ${brief.positive}`);
  return lines.join("\n");
}

/** Puro e deterministico come `compilePanel`, da cui prende seed, proporzioni e zone dei balloon. */
export function compileRenderSpec(input: CompileRenderSpecInput): RenderSpec {
  const { brief, panel } = input;
  const place = panelPlace(panel, input.scene, input.locations);
  const references = selectReferences({
    panel,
    characters: input.characters ?? {},
    ...(input.project ? { style: input.project.style } : {}),
    location: place?.sheet ?? null,
    max: input.maxReferences ?? FLUX2_MAX_REFERENCES,
  });
  const size = snapRenderSize(brief.width, brief.height, input.megapixels ?? 1);
  return {
    panel: brief.panelId,
    target: brief.targetId,
    ...size,
    aspect: brief.aspect,
    prompt: panelPrompt(input, references, place),
    seed: brief.seed,
    model: input.model ?? FLUX2_PRO,
    prompt_upsampling: false,
    output_format: "png",
    references,
    control_image: panel.control_image,
    compiler: RENDER_COMPILER_VERSION,
  };
}

/** JSON con le chiavi ordinate: due spec uguali danno la stessa stringa, comunque siano stati costruiti. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function specHash(spec: RenderSpec): string {
  return sha1Hex(canonicalJson(spec));
}

/** `renders/ep012-p003-03@digital-page.9f2ab31c.png` (§5.7); il sidecar ha lo stesso nome, `.json`. */
export function renderPaths(spec: RenderSpec, hash = specHash(spec)): { image: string; sidecar: string } {
  const base = `${RENDERS_DIR}/${spec.panel}@${spec.target}.${hash.slice(0, 8)}`;
  return { image: `${base}.${spec.output_format}`, sidecar: `${base}.json` };
}

/**
 * La staleness è calcolata, non salvata (§5.7): `fresh` se l'immagine
 * registrata viene dallo spec di oggi, `stale` se il documento è cambiato
 * da allora, `none` se non c'è mai stato un render.
 */
export function renderState(panel: Panel, spec: RenderSpec): "none" | "fresh" | "stale" {
  const record = panel.render[spec.target];
  if (!record) return "none";
  return record.spec_hash === specHash(spec) ? "fresh" : "stale";
}

/**
 * Le viste di una scheda personaggio (F5): quelle che bastano a riconoscerlo
 * da qualunque inquadratura. Un elenco chiuso, come tutto ciò che il
 * compilatore mappa (§5.8).
 */
export const SHEET_VIEWS = {
  front: { label: "fronte", prompt: "front view, head and shoulders portrait, looking at the viewer, neutral expression", width: 1024, height: 1024 },
  "three-quarter": { label: "tre quarti", prompt: "three-quarter view, head and shoulders portrait, looking slightly off-camera, neutral expression", width: 1024, height: 1024 },
  "full-body": { label: "figura intera", prompt: "full body, standing in a relaxed neutral pose, head to feet in frame, facing the viewer", width: 832, height: 1248 },
} as const;
export type SheetView = keyof typeof SHEET_VIEWS;

export const CHARACTER_SHEET_TARGET = "character-sheet";

/**
 * Lo spec di un'immagine di scheda: il personaggio da solo, su fondo neutro,
 * nello stile dell'opera. Serve da riferimento, non da vignetta — per
 * questo niente scena, niente ombre drammatiche, niente altri soggetti.
 *
 * Le tavole di stile si allegano per prime: un riferimento in un altro stile
 * trascinerebbe ogni vignetta in cui il personaggio compare. Poi i
 * riferimenti già tenuti: la seconda vista nasce guardando la prima, e la
 * scheda resta la stessa persona. Il seed cambia a ogni immagine aggiunta,
 * così rigenerare una vista dà una variante.
 */
export function compileCharacterSheetSpec(input: {
  project: Pick<Project, "style" | "series_seed">;
  sheet: CharacterSheet;
  view: SheetView;
  model?: string;
}): RenderSpec {
  const { project, sheet, view } = input;
  const shape = SHEET_VIEWS[view];
  const style: RenderReference[] = used(project.style.references).slice(0, MAX_STYLE_REFERENCES).map((path) => ({ kind: "style", ref: "style", path }));
  const own: RenderReference[] = used(sheet.references).slice(0, FLUX2_MAX_REFERENCES - style.length).map((path) => ({ kind: "character", ref: sheet.id, path }));
  const references = [...style, ...own];
  const wearing = wardrobeText(sheet, "default");
  const shown = indexesOf(references, "character", sheet.id);
  const lines = [
    "Character reference image for a comic: one character alone, on a plain light grey background, even flat lighting, full figure readable.",
    ...styleLines(project, references),
    `View: ${shape.prompt}.`,
    `Character: ${appearanceText(sheet)}.`,
    wearing ? `Wearing: ${fragment(wearing)}.` : null,
    sheet.palette ? `Colours: ${fragment(sheet.palette)}.` : null,
    shown.length > 0 ? `${imageNames(shown)} ${shown.length > 1 ? "show" : "shows"} this same character: keep face, hair, build and costume identical, and change only the view.` : null,
  ].filter((line): line is string => line !== null);
  return {
    panel: `${sheet.id}-${view}`,
    target: CHARACTER_SHEET_TARGET,
    width: shape.width,
    height: shape.height,
    aspect: shape.width === shape.height ? "1:1" : "2:3",
    prompt: lines.join("\n"),
    seed: hash32(`${project.series_seed}:${sheet.id}:${view}:${sheet.references.length}`),
    model: input.model ?? FLUX2_PRO,
    prompt_upsampling: false,
    output_format: "png",
    references,
    control_image: null,
    compiler: RENDER_COMPILER_VERSION,
  };
}

/** Dove va un'immagine di scheda: fra i riferimenti del personaggio, non in `renders/` — da qui in poi è materiale curato dall'autore. */
export function characterSheetPath(spec: RenderSpec, view: SheetView): string {
  const character = spec.panel.slice(0, -(view.length + 1));
  return `characters/${character}/${view}-${specHash(spec).slice(0, 8)}.${spec.output_format}`;
}

export const LOCATION_SHEET_TARGET = "location-sheet";

/**
 * La tavola di un luogo: il posto vuoto, visto largo, nello stile dell'opera.
 * Diventa il riferimento che ogni vignetta ambientata lì si porta dietro —
 * è ciò che tiene la finestra dallo stesso lato e la scrivania della stessa
 * forma. Vuoto di persone di proposito: un personaggio nella tavola finirebbe
 * in ogni vignetta.
 *
 * Le immagini già tenute del luogo si allegano: una seconda tavola è lo
 * stesso posto da un altro punto di vista, non un posto nuovo.
 */
export function compileLocationSpec(input: {
  project: Pick<Project, "style" | "series_seed">;
  location: LocationSheet;
  /** L'ora e la luce della scena in cui serve, se si vuole: di norma una luce neutra che mostri il posto. */
  time?: string;
  model?: string;
}): RenderSpec {
  const { project, location } = input;
  const style: RenderReference[] = used(project.style.references).slice(0, MAX_STYLE_REFERENCES).map((path) => ({ kind: "style", ref: "style", path }));
  const own: RenderReference[] = used(location.references).slice(0, FLUX2_MAX_REFERENCES - style.length).map((path) => ({ kind: "location", ref: location.id, path }));
  const references = [...style, ...own];
  const shown = indexesOf(references, "location", location.id);
  const name = location.name.trim() || location.id;
  const lines = [
    "Establishing view of a place for a comic: the location alone, with nobody in it. Wide shot at eye level, the whole space and its layout readable, clear even light.",
    ...styleLines(project, references),
    `Location: ${name}${location.description.trim() ? ` — ${fragment(location.description)}` : ""}.`,
    location.palette.trim() ? `Location colours: ${fragment(location.palette)}.` : null,
    input.time?.trim() ? `Time: ${fragment(input.time)}.` : null,
    shown.length > 0 ? `${imageNames(shown)} ${shown.length > 1 ? "show" : "shows"} this same place: keep its layout, architecture, furniture, materials and colours identical, and show it from a different angle.` : null,
  ].filter((line): line is string => line !== null);
  return {
    panel: `${location.id}-plate`,
    target: LOCATION_SHEET_TARGET,
    width: 1216,
    height: 832,
    aspect: "3:2",
    prompt: lines.join("\n"),
    seed: hash32(`${project.series_seed}:location:${location.id}:${location.references.length}`),
    model: input.model ?? FLUX2_PRO,
    prompt_upsampling: false,
    output_format: "png",
    references,
    control_image: null,
    compiler: RENDER_COMPILER_VERSION,
  };
}

/** Dove va la tavola di un luogo: fra i riferimenti del luogo, come le viste di un personaggio. */
export function locationSheetPath(spec: RenderSpec): string {
  const location = spec.panel.replace(/-plate$/, "");
  return `locations/${location}/plate-${specHash(spec).slice(0, 8)}.${spec.output_format}`;
}
