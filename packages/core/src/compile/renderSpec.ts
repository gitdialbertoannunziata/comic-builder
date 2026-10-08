import type { CharacterSheet } from "../schema/characters.js";
import type { Panel } from "../schema/panel.js";
import { sha1Hex } from "../util/sha1.js";
import type { Project } from "../schema/project.js";
import { appearanceText, hash32, wardrobeText, type PanelBrief } from "./promptCompiler.js";

/**
 * RenderSpec (§9.1): tutto ciò che decide un'immagine generata, e nient'altro.
 *
 * È l'unità di cache e di staleness (§5.7): l'hash dello spec dà il nome al
 * file in `renders/`, e un pannello è da rigenerare quando lo spec che il
 * documento compila oggi non è più quello che ha prodotto l'immagine.
 *
 * La forma segue il modello scelto per il ramo AI, FLUX.2 [pro]: un prompt
 * in chiaro e fino a otto immagini di riferimento. Non ha prompt negativo,
 * sampler, passi né cfg, e non carica LoRA: la coerenza dei personaggi passa
 * dai riferimenti curati nelle schede (F5), che il prompt nomina per numero.
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
  references: Array<{ character: string; path: string }>;
  control_image: string | null;
  /** Versione del compilatore: alzarla invalida i render quando cambia *come* si compila, non cosa. */
  compiler: number;
}

export const RENDER_COMPILER_VERSION = 1;
export const RENDERS_DIR = "renders";
export const FLUX2_PRO = "flux-2-pro";
/** `input_image` … `input_image_8` nell'API di FLUX.2. */
export const FLUX2_MAX_REFERENCES = 8;

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

/**
 * Quali riferimenti allegare (F5). Solo quelli che l'autore ha tenuto «per
 * generare», e i posti sono pochi: si distribuiscono a giro fra i personaggi
 * del pannello, protagonista per primo, così con tre personaggi nessuno
 * resta senza mentre un altro ne ha quattro.
 */
export function selectReferences(
  panel: Panel,
  sheets: Readonly<Record<string, CharacterSheet>>,
  max = FLUX2_MAX_REFERENCES,
): RenderSpec["references"] {
  const cast = [...panel.characters]
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.weight - a.weight)
    .map((c) => ({ character: c.ref, paths: (sheets[c.ref]?.references ?? []).filter((r) => r.use).map((r) => r.path) }));
  const picked: RenderSpec["references"] = [];
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const { character, paths } of cast) {
      const path = paths[round];
      if (path === undefined || picked.length >= max) continue;
      picked.push({ character, path });
      any = true;
    }
    if (!any) break;
  }
  // Raggruppati per personaggio: «image 1 and image 2 show sara» si legge meglio di numeri sparsi.
  const order = new Map(cast.map((c, i) => [c.character, i]));
  return picked.map((r, i) => ({ r, i })).sort((a, b) => order.get(a.r.character)! - order.get(b.r.character)! || a.i - b.i).map(({ r }) => r);
}

function referenceLines(references: RenderSpec["references"]): string[] {
  if (references.length === 0) return [];
  const byCharacter = new Map<string, number[]>();
  references.forEach((r, i) => byCharacter.set(r.character, [...(byCharacter.get(r.character) ?? []), i + 1]));
  const lines = ["Reference images (identity only — take face, hair, build and costume from them; pose, framing and lighting come from this description):"];
  for (const [character, indexes] of byCharacter) {
    const images = indexes.map((n) => `image ${n}`).join(" and ");
    lines.push(`- ${images} ${indexes.length > 1 ? "show" : "shows"} ${character}: draw ${character} as the same person.`);
  }
  return lines;
}

export interface CompileRenderSpecInput {
  brief: PanelBrief;
  panel: Panel;
  characters?: Readonly<Record<string, CharacterSheet>>;
  model?: string;
  megapixels?: number;
  maxReferences?: number;
}

/** Puro e deterministico come `compilePanel`, da cui prende prompt, seed e proporzioni. */
export function compileRenderSpec(input: CompileRenderSpecInput): RenderSpec {
  const { brief, panel } = input;
  const references = selectReferences(panel, input.characters ?? {}, input.maxReferences ?? FLUX2_MAX_REFERENCES);
  const size = snapRenderSize(brief.width, brief.height, input.megapixels ?? 1);
  // Il brief è scritto per chi allega i riferimenti a mano, e ne elenca i
  // file: qui si allegano da soli, e contano i numeri in fondo al prompt.
  const lines = brief.brief.split("\n").map((line) => line.replace(/(?:; )?reference images: .*\.$/, ".").replace(/\): \.$/, ")."));
  // Dichiara anche i pixel del pannello nella pagina: al modello si dicono solo le proporzioni.
  lines[0] = `Comic panel, aspect ${brief.aspect}. Draw the image only: no text, no speech balloons, no captions, no panel border.`;
  return {
    panel: brief.panelId,
    target: brief.targetId,
    ...size,
    aspect: brief.aspect,
    prompt: [...lines, ...referenceLines(references)].join("\n"),
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
 * nello stile del progetto. Serve da riferimento, non da vignetta — per
 * questo niente scena, niente ombre drammatiche, niente altri soggetti.
 *
 * I riferimenti già tenuti «per generare» si allegano: la seconda vista
 * nasce guardando la prima, e la scheda resta la stessa persona. Il seed
 * cambia a ogni immagine aggiunta, così rigenerare una vista dà una variante.
 */
export function compileCharacterSheetSpec(input: {
  project: Pick<Project, "style" | "series_seed">;
  sheet: CharacterSheet;
  view: SheetView;
  model?: string;
}): RenderSpec {
  const { project, sheet, view } = input;
  const shape = SHEET_VIEWS[view];
  const references = sheet.references.filter((r) => r.use).slice(0, FLUX2_MAX_REFERENCES).map((r) => ({ character: sheet.id, path: r.path }));
  const wearing = wardrobeText(sheet, "default");
  const lines = [
    "Character reference image for a comic. One character only, alone, on a plain light grey background. Even flat lighting, no cast shadows, no props, no text, no border.",
    `View: ${shape.prompt}.`,
    `Character: ${appearanceText(sheet)}.`,
    wearing ? `Wearing: ${wearing}.` : null,
    sheet.palette ? `Palette: ${sheet.palette}.` : null,
    project.style.positive.length > 0 ? `Style: ${project.style.positive.join(", ")}.` : null,
    project.style.negative.length > 0 ? `Avoid: ${project.style.negative.join(", ")}.` : null,
    references.length > 0
      ? `${references.map((_, i) => `image ${i + 1}`).join(" and ")} ${references.length > 1 ? "show" : "shows"} this same character: keep face, hair, build and costume identical, and change only the view.`
      : null,
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
