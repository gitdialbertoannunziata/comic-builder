import type { Box } from "../layout/resolveLayout.js";
import type { Page } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Project } from "../schema/project.js";
import type { Scene } from "../schema/scenes.js";
import type { CharacterSheet } from "../schema/characters.js";
import type { PanelCharacter } from "../schema/panel.js";
import {
  ANGLE_FRAGMENT,
  BASE_NEGATIVE,
  DOF_FRAGMENT,
  FRAMING_FRAGMENT,
  LENS_FRAGMENT,
  LIGHTING_FRAGMENT,
  MOOD_GUIDANCE,
  MOTION_FRAGMENT,
  PLACEMENT_FRAGMENT,
  SHOT_FRAGMENT,
} from "./fragments.js";

/**
 * Compilatore pannello → istruzioni per un modello di immagini (§9.1).
 *
 * Puro e deterministico: il prompt è *derivato* dal documento, non salvato,
 * quindi migliorare il compilatore migliora ogni pannello esistente. Tre
 * uscite, per tre tipi di modello:
 *
 * - `positive`/`negative`: il prompt compatto dei modelli di sole immagini
 *   (Stable Diffusion, Midjourney, Flux);
 * - `brief`: istruzioni in chiaro per i modelli che le seguono (multimodali),
 *   comprese le zone da lasciare libere per i balloon — che la geometria
 *   conosce e il modello no;
 * - i parametri: proporzioni del pannello, bucket SDXL (§7.4), seed.
 *
 * Precedenza dello stile (§9.1): progetto → pannello → `prompt.override`.
 * `mood` e `axis_side` non entrano mai nel prompt (§6.1); il tono entra nel
 * brief, dichiarato come indicazione di composizione e palette.
 */
export interface PanelBrief {
  pageId: string;
  panelId: string;
  targetId: string;
  width: number;
  height: number;
  /** Rapporto nominale più vicino, per i modelli che chiedono "3:4" invece dei pixel. */
  aspect: string;
  /** Il bucket SDXL più vicino (§7.4): i modelli di diffusione vogliono rapporti supportati. */
  sdxl: { width: number; height: number };
  seed: number;
  positive: string;
  negative: string;
  /** Aree da lasciare libere per i balloon, normalizzate al pannello. */
  reservedZones: Array<{ balloonId: string; x: number; y: number; width: number; height: number }>;
  brief: string;
  /** Vero se il prompt viene da `prompt.override` e non dal compilatore. */
  overridden: boolean;
}

export interface CompilePanelInput {
  project: Pick<Project, "style" | "series_seed">;
  page: Page;
  panel: Panel;
  panelBox: Box;
  /** Box dei balloon del pannello nello stesso sistema di `panelBox`. */
  balloonBoxes?: ReadonlyArray<{ id: string; box: Box }>;
  targetId: string;
  scene?: Scene;
  /** Schede personaggio (§5.1): senza, il modello conosce solo un nome e ogni pannello lo reinventa. */
  characters?: Readonly<Record<string, CharacterSheet>>;
}

const ASPECTS: Array<[string, number]> = [
  ["21:9", 21 / 9], ["2:1", 2], ["16:9", 16 / 9], ["3:2", 3 / 2], ["4:3", 4 / 3], ["5:4", 5 / 4], ["1:1", 1],
  ["4:5", 4 / 5], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16], ["1:2", 1 / 2], ["9:21", 9 / 21],
];

const SDXL_BUCKETS: Array<[number, number]> = [
  [1024, 1024], [1152, 896], [1216, 832], [1344, 768], [1536, 640],
  [896, 1152], [832, 1216], [768, 1344], [640, 1536],
];

function nearestByRatio<T>(ratio: number, items: T[], ratioOf: (item: T) => number): T {
  // Distanza sul logaritmo: 2:1 e 1:2 sono ugualmente lontani da 1:1.
  return items.reduce((best, item) => (Math.abs(Math.log(ratioOf(item) / ratio)) < Math.abs(Math.log(ratioOf(best) / ratio)) ? item : best));
}

/** FNV-1a a 32 bit: il seed automatico deriva da serie, pannello ed epoca (§5.7), senza dipendenze. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function panelSeed(project: Pick<Project, "series_seed">, panel: Panel): number {
  if (panel.seed.mode === "override" && panel.seed.value !== null) return panel.seed.value;
  return hash32(`${project.series_seed}:${panel.id}:${panel.seed.epoch}`);
}

const pct = (v: number) => Math.round(v * 100);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** "in alto a sinistra" per un modello: dove sta il centro della zona. */
function where(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const vertical = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : "middle";
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : "center";
  return vertical === "middle" && horizontal === "center" ? "center" : `${vertical} ${horizontal}`;
}

const ROLE_ORDER = { lead: 0, support: 1, background: 2 } as const;

function orderedCharacters(panel: Panel): PanelCharacter[] {
  return [...panel.characters].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.weight - a.weight);
}

/** L'aspetto in forma breve: i campi compilati, nell'ordine in cui si guarda una persona. */
export function appearanceText(sheet: CharacterSheet): string {
  const a = sheet.appearance;
  return [a.age, a.build, a.face, a.hair, a.eyes, a.skin, a.distinguishing].map((v) => v.trim()).filter(Boolean).join(", ");
}

/** Il costume del pannello: la variante dichiarata nella scheda, o il nome così com'è se la scheda non la conosce. */
export function wardrobeText(sheet: CharacterSheet | undefined, wardrobe: string): string | null {
  const described = sheet?.wardrobe[wardrobe];
  if (described) return described;
  return wardrobe !== "default" ? wardrobe : null;
}

function characterLine(panel: Panel, sheets: Readonly<Record<string, CharacterSheet>>): string[] {
  return orderedCharacters(panel).map((c) => {
    const sheet = sheets[c.ref];
    const wearing = wardrobeText(sheet, c.wardrobe);
    const look = sheet ? appearanceText(sheet) : "";
    const details = [
      look || null,
      FRAMING_FRAGMENT[c.framing],
      c.expression ? `expression: ${c.expression}` : null,
      wearing ? `wearing ${wearing}` : null,
    ];
    return `${c.ref} (${[c.role, ...details].filter(Boolean).join(", ")})`;
  });
}

/** Una riga di brief per personaggio con scheda: chi è, com'è, cosa indossa, i riferimenti da allegare. */
function characterBriefLines(panel: Panel, sheets: Readonly<Record<string, CharacterSheet>>): string[] {
  return orderedCharacters(panel).map((c) => {
    const sheet = sheets[c.ref];
    const head = `- ${c.ref}${sheet?.name ? ` «${sheet.name}»` : ""} (${[c.role, FRAMING_FRAGMENT[c.framing], c.expression ? `expression: ${c.expression}` : null].filter(Boolean).join("; ")})`;
    if (!sheet) return `${head}: no character sheet — appearance not specified.`;
    const wearing = wardrobeText(sheet, c.wardrobe);
    const parts = [
      appearanceText(sheet) || null,
      wearing ? `wearing ${wearing}` : null,
      sheet.palette ? `palette: ${sheet.palette}` : null,
      sheet.references.length > 0 ? `reference images: ${sheet.references.map((r) => r.path).join(", ")}` : null,
    ].filter(Boolean);
    return `${head}: ${parts.join("; ") || "sheet present but empty"}.`;
  });
}

export function compilePanel(input: CompilePanelInput): PanelBrief {
  const { project, page, panel, panelBox, targetId, scene } = input;
  const cam = panel.camera;
  const width = Math.round(panelBox.width);
  const height = Math.round(panelBox.height);
  const ratio = panelBox.width / panelBox.height;
  const [aspect] = nearestByRatio(ratio, ASPECTS, ([, r]) => r);
  const [sw, sh] = nearestByRatio(ratio, SDXL_BUCKETS, ([w, h]) => w / h);

  const sheets = input.characters ?? {};
  const characters = characterLine(panel, sheets);
  const withSheets = panel.characters.some((c) => sheets[c.ref]);
  const setting = panel.setting || (scene ? `${scene.location}, ${scene.time_of_day}` : "");
  const compiled = [
    SHOT_FRAGMENT[cam.shot],
    ANGLE_FRAGMENT[cam.angle],
    LENS_FRAGMENT[cam.lens_mm],
    DOF_FRAGMENT[cam.dof],
    PLACEMENT_FRAGMENT[cam.subject_placement],
    ...characters,
    panel.action,
    setting,
    panel.props.length > 0 ? panel.props.join(", ") : null,
    LIGHTING_FRAGMENT[cam.lighting],
    MOTION_FRAGMENT[cam.motion],
    ...project.style.positive,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    // Nel prompt compatto le parti sono separate da virgole: la punteggiatura
    // finale di una frase dell'autore («…dalla porta.») diventerebbe «.,».
    .map((part) => part.trim().replace(/[.;:!]+$/, ""));

  const overridden = panel.prompt.override !== null;
  const positive = overridden ? panel.prompt.override! : compiled.join(", ");
  const negative = panel.prompt.negative_override ?? [...BASE_NEGATIVE, ...project.style.negative].filter((v, i, all) => all.indexOf(v) === i).join(", ");

  const reservedZones = (input.balloonBoxes ?? []).map(({ id, box }) => {
    const x = Math.max(0, (box.x - panelBox.x) / panelBox.width);
    const y = Math.max(0, (box.y - panelBox.y) / panelBox.height);
    const right = Math.min(1, (box.x + box.width - panelBox.x) / panelBox.width);
    const bottom = Math.min(1, (box.y + box.height - panelBox.y) / panelBox.height);
    return { balloonId: id, x: r2(x), y: r2(y), width: r2(right - x), height: r2(bottom - y) };
  });

  const lines: string[] = [
    `Comic panel, aspect ${aspect} (${width}×${height} px). Draw the image only: no text, no speech balloons, no captions, no panel border.`,
    `Framing: ${[SHOT_FRAGMENT[cam.shot], ANGLE_FRAGMENT[cam.angle], LENS_FRAGMENT[cam.lens_mm], DOF_FRAGMENT[cam.dof]].filter(Boolean).join("; ")}.`,
  ];
  if (panel.characters.length === 0) lines.push("No characters in frame.");
  else if (withSheets) lines.push("Characters (keep each one consistent with this description in every panel):", ...characterBriefLines(panel, sheets));
  else lines.push(`Characters: ${characters.join("; ")}.`);
  if (PLACEMENT_FRAGMENT[cam.subject_placement]) lines.push(`Composition: ${PLACEMENT_FRAGMENT[cam.subject_placement]}.`);
  if (panel.action) lines.push(`Action: ${panel.action}`);
  if (setting) lines.push(`Setting: ${setting}`);
  if (panel.props.length > 0) lines.push(`${cam.shot === "INSERT" ? "Focus on" : "Props"}: ${panel.props.join(", ")}.`);
  lines.push(`Lighting: ${LIGHTING_FRAGMENT[cam.lighting]}.`);
  if (MOTION_FRAGMENT[cam.motion]) lines.push(`Motion: ${MOTION_FRAGMENT[cam.motion]}.`);
  lines.push(`Tone (composition and palette, not a subject): ${MOOD_GUIDANCE[cam.mood]}.`);
  if (panel.continuity_notes) lines.push(`Continuity: ${panel.continuity_notes}`);
  for (const zone of reservedZones) {
    lines.push(
      `Keep the ${where(zone.x, zone.y, zone.width, zone.height)} area free of important detail (x ${pct(zone.x)}–${pct(zone.x + zone.width)}%, y ${pct(zone.y)}–${pct(zone.y + zone.height)}%): a speech balloon goes there.`,
    );
  }
  if (project.style.positive.length > 0) lines.push(`Style: ${project.style.positive.join(", ")}.`);
  lines.push(`Avoid: ${negative}.`);
  if (overridden) lines.push(`Author's prompt for this panel (takes precedence): ${positive}`);

  return {
    pageId: page.id,
    panelId: panel.id,
    targetId,
    width,
    height,
    aspect,
    sdxl: { width: sw, height: sh },
    seed: panelSeed(project, panel),
    positive,
    negative,
    reservedZones,
    brief: lines.join("\n"),
    overridden,
  };
}

/**
 * La pagina intera, per i modelli che generano pagine: la griglia in
 * percentuali e in ordine di lettura, poi il brief di ogni pannello.
 */
export function compilePageBrief(input: {
  page: Page;
  pageBox: Box;
  panels: readonly PanelBrief[];
  boxes: Map<string, Box>;
  readingDirection: "ltr" | "rtl";
}): string {
  const { page, pageBox, panels, boxes, readingDirection } = input;
  const ratio = pageBox.width / pageBox.height;
  const [aspect] = nearestByRatio(ratio, ASPECTS, ([, r]) => r);
  const lines = [
    `Comic page ${page.id}, aspect ${aspect}, ${panels.length} panels, read ${readingDirection === "rtl" ? "right to left" : "left to right"}, top to bottom.`,
    "Keep the gutters white and the panel borders clean. Draw no text and no speech balloons anywhere.",
    "",
  ];
  panels.forEach((brief, i) => {
    const box = boxes.get(brief.panelId);
    const position = box
      ? ` — at x ${pct((box.x - pageBox.x) / pageBox.width)}%, y ${pct((box.y - pageBox.y) / pageBox.height)}%, ${pct(box.width / pageBox.width)}% × ${pct(box.height / pageBox.height)}% of the page`
      : "";
    lines.push(`Panel ${i + 1} (${brief.panelId})${position}`, brief.brief, "");
  });
  return lines.join("\n").trimEnd();
}
