import type { ProjectDoc } from "../document/projectDoc.js";
import type { Page } from "../schema/page.js";
import type { Area, Panel } from "../schema/panel.js";
import type { Balloon, TextRun, Tail } from "../schema/balloon.js";
import type { Camera } from "../schema/camera.js";
import { nextBalloonId, nextIndex, nextPanelId, pageId as derivePageId, panelId as derivePanelId, trailingIndex } from "../script/ids.js";
import { validateDocument } from "../validate/validateDocument.js";
import { getTemplate } from "../templates/catalog.js";
import { expandTemplate } from "../templates/expand.js";
import { remapProvenance } from "../revisions/scriptDiff.js";
import { findMatches, matchesAsRevisions, type FindOptions } from "../revisions/findReplace.js";
import { refFromName } from "../revisions/readable.js";
import { characterRefs, renameCharacterRefs } from "./renameCharacter.js";
import { CharacterSheetSchema, type CharacterSheet } from "../schema/characters.js";
import { addRevisions, applyRevisions, emptyRevisions, rejectRevisions, RevisionConflict, type NewRevision } from "../revisions/revisionCommands.js";

/**
 * Comandi tipizzati (§11.3): l'unico modo di modificare il documento.
 *
 * Ogni comando è una funzione pura `ProjectDoc → ProjectDoc` che ricopia
 * solo il ramo che tocca: pagina, pannello, balloon. Il resto è condiviso
 * con lo stato precedente. Questo rende l'undo un riferimento e il
 * salvataggio incrementale gratuito (vedi `changedFiles`).
 *
 * Un comando che lascerebbe la pagina non valida — un buco nella griglia,
 * un ordine di lettura rotto — non si applica: lancia `CommandError` con un
 * messaggio per l'utente. L'editor non produce mai un documento che poi non
 * si potrebbe salvare.
 */
export type Command =
  | { type: "balloon.move"; pageId: string; balloonId: string; anchor: Point; target?: string }
  | { type: "balloon.tail"; pageId: string; balloonId: string; tail: Tail; target?: string }
  | { type: "balloon.text"; pageId: string; balloonId: string; text: TextRun[] }
  | { type: "balloon.update"; pageId: string; balloonId: string; patch: BalloonPatch }
  | { type: "balloon.scale"; pageId: string; balloonId: string; fontScale: number; target?: string }
  | { type: "balloon.reset"; pageId: string; balloonId: string; target: string }
  | { type: "balloon.add"; pageId: string; panelId: string; text: TextRun[]; anchor?: Point; balloonType?: Balloon["type"] }
  | { type: "balloon.remove"; pageId: string; balloonId: string }
  | { type: "panel.update"; pageId: string; panelId: string; patch: PanelPatch }
  | { type: "panel.camera"; pageId: string; panelId: string; camera: Partial<Camera> }
  | { type: "panel.merge"; pageId: string; panelIds: [string, string] }
  | { type: "panel.split"; pageId: string; panelId: string; axis: "cols" | "rows" }
  | { type: "layout.tracks"; pageId: string; cols?: number[]; rows?: number[] }
  | { type: "layout.gutter"; pageId: string; gutter: { x: number; y: number } }
  | { type: "page.add"; chapterId: string; templateId: string; after?: string; sceneId: string }
  | { type: "page.remove"; pageId: string }
  | { type: "page.move"; pageId: string; toIndex: number }
  | { type: "revision.add"; chapterId: string; entries: NewRevision[]; by: string; at: string }
  | { type: "revision.apply"; chapterId: string; ids: string[]; by: string; at: string }
  | { type: "revision.reject"; chapterId: string; ids: string[]; by: string; at: string }
  | { type: "script.set"; chapterId: string; text: string; sha: string }
  | { type: "text.replace"; chapterId: string; find: string; replace: string; options: FindOptions; by: string; at: string }
  | { type: "character.rename"; from: string; to: string }
  | { type: "project.style"; positive: string[]; negative: string[] }
  | { type: "character.upsert"; ref: string; patch: CharacterPatch }
  | { type: "character.remove"; ref: string };

export type CharacterPatch = Partial<Omit<CharacterSheet, "schema" | "id" | "appearance">> & { appearance?: Partial<CharacterSheet["appearance"]> };

export interface Point {
  x: number;
  y: number;
}

export type BalloonPatch = Partial<Pick<Balloon, "type" | "font_scale" | "speaker" | "size_mode" | "z">>;
export type PanelPatch = Partial<
  Pick<Panel, "action" | "setting" | "props" | "continuity_notes" | "characters" | "border" | "art" | "slice_avoid" | "prompt">
>;

export class CommandError extends Error {}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function requirePage(doc: ProjectDoc, id: string): Page {
  const page = doc.pages[id];
  if (!page) throw new CommandError(`Pagina ${id} inesistente`);
  return page;
}

function gridLayout(page: Page) {
  if (page.layout.mode !== "page") throw new CommandError(`La pagina ${page.id} non è una pagina a griglia`);
  return page.layout;
}

/**
 * `variants[target]` dice quali balloon sono ritoccati per un formato (§5.4):
 * è ciò che permette di sapere, senza aprire ogni balloon, che la B5 o la
 * striscia di una pagina non sono più "derivate" ma sistemate a mano. Si
 * ricalcola dagli override dopo ogni comando, così non può divergere da essi
 * — nemmeno quando un merge o uno split li azzera.
 */
function syncVariants(page: Page): Page {
  const byTarget = new Map<string, string[]>();
  for (const balloon of [...page.panels.flatMap((p) => p.balloons), ...page.overlays]) {
    for (const target of Object.keys(balloon.per_target)) byTarget.set(target, [...(byTarget.get(target) ?? []), balloon.id]);
  }
  let changed = false;
  const variants = { ...page.variants };
  for (const target of new Set([...Object.keys(variants), ...byTarget.keys()])) {
    const ids = byTarget.get(target) ?? [];
    const current = variants[target];
    const status = ids.length > 0 ? "tuned" : "derived";
    if (!current && ids.length === 0) continue;
    if (current && current.status === status && current.balloon_overrides.join("\u0000") === ids.join("\u0000")) continue;
    variants[target] = { ...current, status, balloon_overrides: ids };
    changed = true;
  }
  return changed ? { ...page, variants } : page;
}

function withPage(doc: ProjectDoc, rawPage: Page, options: { validate?: boolean } = {}): ProjectDoc {
  const page = syncVariants(rawPage);
  if (options.validate) {
    const errors = validateDocument(page).filter((i) => i.level === "error");
    if (errors.length > 0) throw new CommandError(`La pagina diventerebbe non valida: ${errors[0]!.message}`);
  }
  return { ...doc, pages: { ...doc.pages, [page.id]: page } };
}

function findBalloon(page: Page, balloonId: string): { panelIndex: number; balloonIndex: number } | { overlayIndex: number } {
  for (let p = 0; p < page.panels.length; p++) {
    const b = page.panels[p]!.balloons.findIndex((x) => x.id === balloonId);
    if (b >= 0) return { panelIndex: p, balloonIndex: b };
  }
  const o = page.overlays.findIndex((x) => x.id === balloonId);
  if (o >= 0) return { overlayIndex: o };
  throw new CommandError(`Balloon ${balloonId} inesistente nella pagina ${page.id}`);
}

function mapBalloon(page: Page, balloonId: string, change: (b: Balloon) => Balloon): Page {
  const at = findBalloon(page, balloonId);
  if ("overlayIndex" in at) {
    return { ...page, overlays: page.overlays.map((b, i) => (i === at.overlayIndex ? change(b) : b)) };
  }
  return {
    ...page,
    panels: page.panels.map((panel, p) =>
      p !== at.panelIndex ? panel : { ...panel, balloons: panel.balloons.map((b, i) => (i === at.balloonIndex ? change(b) : b)) },
    ),
  };
}

function mapPanel(page: Page, panelId: string, change: (p: Panel) => Panel): Page {
  if (!page.panels.some((p) => p.id === panelId)) throw new CommandError(`Pannello ${panelId} inesistente`);
  return { ...page, panels: page.panels.map((p) => (p.id === panelId ? change(p) : p)) };
}

/**
 * Posizione per target (§4.1 regola 3): sul target canonico si sposta il
 * balloon; su un altro si scrive un override, e il canonico resta com'era.
 */
function isPrimary(page: Page, target: string | undefined): boolean {
  return target === undefined || page.layout.mode !== "page" || target === page.layout.primary_target;
}

// --- Geometria normalizzata della griglia, per rimappare le ancore quando i pannelli cambiano forma ---

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function trackStarts(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const starts = [0];
  for (const w of weights) starts.push(starts[starts.length - 1]! + w / total);
  return starts;
}

function areaRect(area: Area, cols: readonly number[], rows: readonly number[]): Rect {
  const cx = trackStarts(cols);
  const ry = trackStarts(rows);
  const x = cx[area.col]!;
  const y = ry[area.row]!;
  return { x, y, w: cx[area.col + area.col_span]! - x, h: ry[area.row + area.row_span]! - y };
}

/** Un punto normalizzato al rettangolo `from`, riespresso nel rettangolo `to`. */
function remap(point: Point, from: Rect, to: Rect): Point {
  return {
    x: clamp01((from.x + point.x * from.w - to.x) / to.w),
    y: clamp01((from.y + point.y * from.h - to.y) / to.h),
  };
}

function remapBalloon(b: Balloon, from: Rect, to: Rect): Balloon {
  const tail = b.tail.target ? { ...b.tail, target: remap(b.tail.target, from, to) } : b.tail;
  // Gli override per target si riferiscono a una geometria che è appena
  // cambiata: tenerli vorrebbe dire puntare a posizioni ormai senza senso.
  return { ...b, anchor: remap(b.anchor, from, to), tail, per_target: {} };
}

// --- Merge e split ---

function mergePanels(page: Page, [a, b]: [string, string]): Page {
  const layout = gridLayout(page);
  const pa = page.panels.find((p) => p.id === a);
  const pb = page.panels.find((p) => p.id === b);
  if (!pa || !pb || a === b) throw new CommandError("Per unire servono due pannelli distinti della pagina");

  const horizontal = pa.area.row === pb.area.row && pa.area.row_span === pb.area.row_span &&
    (pa.area.col + pa.area.col_span === pb.area.col || pb.area.col + pb.area.col_span === pa.area.col);
  const vertical = pa.area.col === pb.area.col && pa.area.col_span === pb.area.col_span &&
    (pa.area.row + pa.area.row_span === pb.area.row || pb.area.row + pb.area.row_span === pa.area.row);
  if (!horizontal && !vertical) {
    throw new CommandError("Si uniscono solo due pannelli affiancati che insieme formano un rettangolo");
  }

  // Resta il pannello che si legge prima: è quello che il lettore incontra.
  const order = layout.reading_order;
  const [keep, gone] = order.indexOf(a) <= order.indexOf(b) ? [pa, pb] : [pb, pa];
  if (gone.art.source) {
    throw new CommandError(`Il pannello ${gone.id} ha già l'arte: unirlo la perderebbe. Scollega prima l'arte.`);
  }

  const area: Area = {
    col: Math.min(pa.area.col, pb.area.col),
    row: Math.min(pa.area.row, pb.area.row),
    col_span: horizontal ? pa.area.col_span + pb.area.col_span : pa.area.col_span,
    row_span: vertical ? pa.area.row_span + pb.area.row_span : pa.area.row_span,
    z: keep.area.z,
  };
  const to = areaRect(area, layout.cols, layout.rows);
  const fromKeep = areaRect(keep.area, layout.cols, layout.rows);
  const fromGone = areaRect(gone.area, layout.cols, layout.rows);

  const characters = [...keep.characters];
  for (const c of gone.characters) if (!characters.some((x) => x.ref === c.ref)) characters.push(c);

  const merged: Panel = {
    ...keep,
    area,
    action: [keep.action, gone.action].filter((s) => s.trim().length > 0).join(" "),
    props: [...new Set([...keep.props, ...gone.props])],
    characters,
    // I balloon del pannello tolto non si perdono: passano nel pannello unito,
    // con i loro id (che restano stabili, §5.3) e la stessa posizione sulla pagina.
    balloons: [
      ...keep.balloons.map((x) => remapBalloon(x, fromKeep, to)),
      ...gone.balloons.map((x) => remapBalloon(x, fromGone, to)),
    ],
    slice_avoid: [],
  };

  return {
    ...page,
    // Il pannello tolto ha speso il suo id: il contatore lo ricorda.
    panel_seq: Math.max(page.panel_seq ?? 0, ...page.panels.map((p) => trailingIndex(p.id))),
    panels: page.panels.filter((p) => p.id !== gone.id).map((p) => (p.id === keep.id ? merged : p)),
    layout: { ...layout, reading_order: order.filter((id) => id !== gone.id) },
  };
}

function splitPanel(page: Page, panelId: string, axis: "cols" | "rows"): Page {
  let layout = gridLayout(page);
  const original = page.panels.find((p) => p.id === panelId);
  if (!original) throw new CommandError(`Pannello ${panelId} inesistente`);

  const startKey = axis === "cols" ? "col" : "row";
  const spanKey = axis === "cols" ? "col_span" : "row_span";
  let panels = page.panels;
  let area = original.area;

  // Un pannello su una traccia sola: prima si divide la traccia in due metà,
  // allargando di uno chi la attraversa e spostando chi viene dopo. La
  // pagina resta identica a vista; solo ora il pannello ha un confine interno.
  if (area[spanKey] === 1) {
    const track = area[startKey];
    const weights = [...layout[axis]];
    const w = weights[track]!;
    weights.splice(track, 1, w / 2, w / 2);
    layout = { ...layout, [axis]: weights };
    panels = panels.map((p) => {
      const s = p.area[startKey];
      const e = s + p.area[spanKey];
      if (s > track) return { ...p, area: { ...p.area, [startKey]: s + 1 } };
      if (s <= track && e > track) return { ...p, area: { ...p.area, [spanKey]: p.area[spanKey] + 1 } };
      return p;
    });
    area = panels.find((p) => p.id === panelId)!.area;
  }

  const firstSpan = Math.floor(area[spanKey] / 2);
  const firstArea: Area = { ...area, [spanKey]: firstSpan };
  const secondArea: Area = { ...area, [startKey]: area[startKey] + firstSpan, [spanKey]: area[spanKey] - firstSpan };

  const whole = areaRect(area, layout.cols, layout.rows);
  const firstRect = areaRect(firstArea, layout.cols, layout.rows);
  const secondRect = areaRect(secondArea, layout.cols, layout.rows);

  const current = panels.find((p) => p.id === panelId)!;
  const newId = nextPanelId(page.id, page.panels.map((p) => p.id), page.panel_seq);
  const stays: Balloon[] = [];
  const moves: Balloon[] = [];
  for (const b of current.balloons) {
    const onPage = { x: whole.x + b.anchor.x * whole.w, y: whole.y + b.anchor.y * whole.h };
    const inSecond = axis === "cols" ? onPage.x >= secondRect.x : onPage.y >= secondRect.y;
    if (inSecond) moves.push(remapBalloon(b, whole, secondRect));
    else stays.push(remapBalloon(b, whole, firstRect));
  }

  const first: Panel = { ...current, area: firstArea, balloons: stays, slice_avoid: [] };
  // Il pannello nuovo nasce dallo stesso beat e con la stessa camera: è la
  // continuazione del momento, e l'autore la cambia da lì.
  const second: Panel = {
    ...current,
    id: newId,
    area: secondArea,
    action: "",
    characters: [],
    props: [],
    continuity_notes: "",
    balloons: moves,
    art: { source: null, status: "missing" },
    render: {},
    seed: { ...current.seed, epoch: 0 },
    slice_avoid: [],
  };

  const index = panels.findIndex((p) => p.id === panelId);
  const nextPanels = [...panels.slice(0, index), first, second, ...panels.slice(index + 1)];
  const order = layout.reading_order;
  const at = order.indexOf(panelId);
  return {
    ...page,
    panel_seq: trailingIndex(newId),
    panels: nextPanels,
    layout: { ...layout, reading_order: [...order.slice(0, at + 1), newId, ...order.slice(at + 1)] },
  };
}

// --- Pagine ---

function chapterOf(doc: ProjectDoc, pageIdValue: string) {
  const chapter = doc.chapters.chapters.find((c) => c.pages.includes(pageIdValue));
  if (!chapter) throw new CommandError(`La pagina ${pageIdValue} non è in nessun capitolo`);
  return chapter;
}

/** `order` segue la posizione nel capitolo: le due informazioni non devono mai divergere (§5.4). */
function withChapterPages(
  doc: ProjectDoc,
  chapterId: string,
  pageIds: string[],
  pages: Record<string, Page>,
  spentPageNumber?: number,
): ProjectDoc {
  const renumbered: Record<string, Page> = { ...pages };
  pageIds.forEach((id, i) => {
    const page = renumbered[id]!;
    if (page.order !== i + 1) renumbered[id] = { ...page, order: i + 1 };
  });
  return {
    ...doc,
    pages: renumbered,
    chapters: {
      ...doc.chapters,
      chapters: doc.chapters.chapters.map((c) =>
        c.id !== chapterId
          ? c
          : {
              ...c,
              pages: pageIds,
              ...(spentPageNumber !== undefined ? { page_seq: Math.max(c.page_seq ?? 0, spentPageNumber) } : {}),
            },
      ),
    },
  };
}

function highestPageNumber(chapterId: string, ids: readonly string[]): number {
  let highest = 0;
  for (const id of ids) {
    const match = new RegExp(`^${chapterId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-p(\\d+)$`).exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

function addPage(doc: ProjectDoc, command: Extract<Command, { type: "page.add" }>): ProjectDoc {
  const chapter = doc.chapters.chapters.find((c) => c.id === command.chapterId);
  if (!chapter) throw new CommandError(`Capitolo ${command.chapterId} inesistente`);
  const template = getTemplate(command.templateId);
  if (!template) throw new CommandError(`Template ${command.templateId} inesistente`);

  // Come per i pannelli: si prende il massimo, un id cancellato resta speso (§5.3).
  const number = Math.max(highestPageNumber(chapter.id, Object.keys(doc.pages)), chapter.page_seq ?? 0) + 1;
  const id = derivePageId(chapter.id, number);
  const panelIds = template.areas.map((_, i) => derivePanelId(id, i + 1));
  const primary = doc.project.targets.find((t) => t.kind === "page" && t.primary)?.id ?? "digital-page";
  const reference = chapter.pages.map((p) => doc.pages[p]).find((p) => p?.layout.mode === "page");
  const gutter = reference?.layout.mode === "page" ? reference.layout.gutter : { x: 14, y: 18 };
  const { layout, areas } = expandTemplate(template, panelIds, {
    primaryTarget: primary,
    gutter,
    readingDirection: doc.project.reading_direction,
  });

  const page: Page = {
    schema: 1,
    id,
    chapter_id: chapter.id,
    order: 0,
    spread_with: null,
    layout,
    variants: {},
    overlays: [],
    panels: panelIds.map((panelIdValue, i) => blankPanel(panelIdValue, areas[i]!, command.sceneId)),
    panel_seq: panelIds.length,
  };

  const pageIds = [...chapter.pages];
  const at = command.after ? pageIds.indexOf(command.after) + 1 : pageIds.length;
  pageIds.splice(at <= 0 ? pageIds.length : at, 0, id);
  return withChapterPages(doc, chapter.id, pageIds, { ...doc.pages, [id]: page }, number);
}

function blankPanel(id: string, area: { col: number; row: number; col_span: number; row_span: number; z?: number }, sceneId: string): Panel {
  return {
    id,
    scene_id: sceneId,
    beat_index: 0,
    source: null,
    area: { col: area.col, row: area.row, col_span: area.col_span, row_span: area.row_span, z: area.z ?? 0 },
    border: { style: "solid", width: 3, radius: 0 },
    camera: {
      shot: "MS",
      angle: "eye",
      lens_mm: 35,
      dof: "deep",
      lighting: "flat",
      mood: "calm",
      motion: "static",
      subject_placement: "center",
      axis_side: "A-left",
    },
    action: "",
    setting: "",
    props: [],
    continuity_notes: "",
    characters: [],
    art: { source: null, status: "missing" },
    prompt: { override: null, negative_override: null },
    control_image: null,
    seed: { mode: "auto", value: null, epoch: 0 },
    render: {},
    balloons: [],
    slice_avoid: [],
  };
}

// --- Applicazione ---

export function applyCommand(doc: ProjectDoc, command: Command): ProjectDoc {
  switch (command.type) {
    case "balloon.move": {
      const page = requirePage(doc, command.pageId);
      const anchor = { x: clamp01(command.anchor.x), y: clamp01(command.anchor.y) };
      return withPage(
        doc,
        mapBalloon(page, command.balloonId, (b) =>
          isPrimary(page, command.target)
            ? { ...b, anchor }
            : { ...b, per_target: { ...b.per_target, [command.target!]: { ...b.per_target[command.target!], anchor } } },
        ),
      );
    }
    case "balloon.tail": {
      const page = requirePage(doc, command.pageId);
      return withPage(
        doc,
        mapBalloon(page, command.balloonId, (b) =>
          isPrimary(page, command.target)
            ? { ...b, tail: command.tail }
            : { ...b, per_target: { ...b.per_target, [command.target!]: { ...b.per_target[command.target!], tail: command.tail } } },
        ),
      );
    }
    case "balloon.text": {
      if (command.text.length === 0 || command.text.every((r) => r.t.length === 0)) {
        throw new CommandError("Un balloon non può restare senza testo: per toglierlo, eliminalo");
      }
      const page = requirePage(doc, command.pageId);
      // `rev` sale a ogni cambio di testo: è ciò che dice quali balloon vanno
      // riletterati e che il changelog delle revisioni referenzia (§5.6, §10.2).
      return withPage(doc, mapBalloon(page, command.balloonId, (b) => ({ ...b, text: command.text, rev: b.rev + 1 })));
    }
    case "balloon.update": {
      const page = requirePage(doc, command.pageId);
      return withPage(doc, mapBalloon(page, command.balloonId, (b) => ({ ...b, ...command.patch })));
    }
    case "balloon.scale": {
      if (!(command.fontScale > 0)) throw new CommandError("Il corpo deve essere positivo");
      const page = requirePage(doc, command.pageId);
      const fontScale = command.fontScale;
      return withPage(
        doc,
        mapBalloon(page, command.balloonId, (b) =>
          isPrimary(page, command.target)
            ? { ...b, font_scale: fontScale }
            : { ...b, per_target: { ...b.per_target, [command.target!]: { ...b.per_target[command.target!], font_scale: fontScale } } },
        ),
      );
    }
    case "balloon.reset": {
      const page = requirePage(doc, command.pageId);
      // Il balloon torna a derivare dal canonico per questo formato.
      return withPage(
        doc,
        mapBalloon(page, command.balloonId, (b) => {
          if (!b.per_target[command.target]) return b;
          return { ...b, per_target: Object.fromEntries(Object.entries(b.per_target).filter(([t]) => t !== command.target)) };
        }),
      );
    }
    case "balloon.add": {
      const page = requirePage(doc, command.pageId);
      return withPage(
        doc,
        mapPanel(page, command.panelId, (panel) => {
          const id = nextBalloonId(panel.id, panel.balloons.map((b) => b.id), panel.balloon_seq);
          const balloon: Balloon = {
            id,
            type: command.balloonType ?? "speech",
            speaker: { ref: null, visible: true },
            text: command.text,
            anchor: command.anchor ?? { x: 0.08, y: 0.08 },
            tail: { mode: "auto" },
            size_mode: "grow",
            font_scale: 1,
            per_target: {},
            z: panel.balloons.length,
            rev: 0,
          };
          return { ...panel, balloons: [...panel.balloons, balloon], balloon_seq: trailingIndex(id) };
        }),
      );
    }
    case "balloon.remove": {
      const page = requirePage(doc, command.pageId);
      findBalloon(page, command.balloonId);
      return withPage(doc, {
        ...page,
        panels: page.panels.map((p) =>
          p.balloons.some((b) => b.id === command.balloonId)
            ? {
                ...p,
                balloons: p.balloons.filter((b) => b.id !== command.balloonId),
                balloon_seq: Math.max(p.balloon_seq ?? 0, nextIndex(p.balloons.map((b) => b.id), `${p.id}-b`) - 1),
              }
            : p,
        ),
        overlays: page.overlays.filter((b) => b.id !== command.balloonId),
      });
    }
    case "panel.update": {
      const page = requirePage(doc, command.pageId);
      return withPage(doc, mapPanel(page, command.panelId, (p) => ({ ...p, ...command.patch })));
    }
    case "panel.camera": {
      const page = requirePage(doc, command.pageId);
      return withPage(doc, mapPanel(page, command.panelId, (p) => ({ ...p, camera: { ...p.camera, ...command.camera } })));
    }
    case "panel.merge":
      return withPage(doc, mergePanels(requirePage(doc, command.pageId), command.panelIds), { validate: true });
    case "panel.split":
      return withPage(doc, splitPanel(requirePage(doc, command.pageId), command.panelId, command.axis), { validate: true });
    case "layout.tracks": {
      const page = requirePage(doc, command.pageId);
      const layout = gridLayout(page);
      for (const weights of [command.cols, command.rows]) {
        if (!weights) continue;
        if (weights.some((w) => !(w > 0))) throw new CommandError("Ogni traccia deve avere un peso positivo");
      }
      if (command.cols && command.cols.length !== layout.cols.length) throw new CommandError("Il numero di colonne non cambia trascinando");
      if (command.rows && command.rows.length !== layout.rows.length) throw new CommandError("Il numero di righe non cambia trascinando");
      return withPage(doc, { ...page, layout: { ...layout, cols: command.cols ?? layout.cols, rows: command.rows ?? layout.rows } });
    }
    case "layout.gutter": {
      const page = requirePage(doc, command.pageId);
      const layout = gridLayout(page);
      if (command.gutter.x < 0 || command.gutter.y < 0) throw new CommandError("Il gutter non può essere negativo");
      return withPage(doc, { ...page, layout: { ...layout, gutter: command.gutter } });
    }
    case "page.add":
      return addPage(doc, command);
    case "page.remove": {
      requirePage(doc, command.pageId);
      const chapter = chapterOf(doc, command.pageId);
      if (chapter.pages.length === 1) throw new CommandError("Un capitolo non può restare senza pagine");
      const pages = Object.fromEntries(Object.entries(doc.pages).filter(([id]) => id !== command.pageId));
      return withChapterPages(doc, chapter.id, chapter.pages.filter((id) => id !== command.pageId), pages, trailingIndex(command.pageId));
    }
    case "revision.add":
      return addRevisions(doc, command.chapterId, command.entries, command.by, command.at);
    case "revision.apply":
      try {
        return applyRevisions(doc, command.chapterId, command.ids, command.by, command.at, applyCommand);
      } catch (error) {
        if (error instanceof RevisionConflict) throw new CommandError(`Correzioni non applicabili: ${error.message}`);
        throw error;
      }
    case "revision.reject":
      return rejectRevisions(doc, command.chapterId, command.ids, command.by, command.at);
    case "text.replace": {
      const matches = findMatches(doc, command.chapterId, command.find, command.replace, command.options);
      if (matches.length === 0) throw new CommandError(`Nessuna occorrenza di «${command.find}» da sostituire`);
      // Ogni sostituzione è una correzione tracciata, già applicata.
      const before = new Set((doc.revisions[command.chapterId]?.entries ?? []).map((e) => e.id));
      const added = addRevisions(doc, command.chapterId, matchesAsRevisions(matches), command.by, command.at);
      const ids = (added.revisions[command.chapterId]?.entries ?? []).filter((e) => !before.has(e.id)).map((e) => e.id);
      return applyRevisions(added, command.chapterId, ids, command.by, command.at, applyCommand);
    }
    case "character.rename": {
      const to = refFromName(command.to);
      if (!to) throw new CommandError("Il nome nuovo è vuoto");
      if (to === command.from) throw new CommandError("Il nome è già quello");
      const refs = characterRefs(doc);
      if (!refs.has(command.from)) throw new CommandError(`Nessun personaggio «${command.from}» nel progetto`);
      // Unire due personaggi è un'altra operazione: farla per sbaglio confonderebbe due persone.
      if (refs.has(to)) throw new CommandError(`Esiste già un personaggio «${to}»`);
      const renamed = renameCharacterRefs(doc, command.from, to);
      // La scheda segue il personaggio: rinominare senza portarsi dietro
      // l'aspetto sarebbe perderlo in silenzio.
      const sheet = doc.characters[command.from];
      if (!sheet) return renamed;
      const characters = Object.fromEntries(Object.entries(renamed.characters).filter(([ref]) => ref !== command.from));
      return { ...renamed, characters: { ...characters, [to]: { ...sheet, id: to } } };
    }
    case "character.upsert": {
      const ref = refFromName(command.ref);
      if (!ref || ref !== command.ref) throw new CommandError(`«${command.ref}» non è un ref valido: minuscolo, senza spazi né accenti (es. ${ref || "sara"})`);
      const current = doc.characters[ref] ?? CharacterSheetSchema.parse({ schema: 1, id: ref });
      const { appearance, ...rest } = command.patch;
      const next: CharacterSheet = { ...current, ...rest, appearance: { ...current.appearance, ...appearance }, schema: 1, id: ref };
      return { ...doc, characters: { ...doc.characters, [ref]: next } };
    }
    case "character.remove": {
      if (!doc.characters[command.ref]) throw new CommandError(`Nessuna scheda per «${command.ref}»`);
      return { ...doc, characters: Object.fromEntries(Object.entries(doc.characters).filter(([ref]) => ref !== command.ref)) };
    }
    case "project.style": {
      // La bibbia di stile del progetto (§5.2): vale per ogni pannello, sotto il prompt dell'autore.
      const clean = (list: string[]) => list.map((s) => s.trim()).filter((s) => s.length > 0);
      return { ...doc, project: { ...doc.project, style: { ...doc.project.style, positive: clean(command.positive), negative: clean(command.negative) } } };
    }
    case "script.set": {
      // Il copione nuovo diventa il riferimento: le prossime revisioni si confrontano con questo.
      const revs = doc.revisions[command.chapterId] ?? emptyRevisions(command.chapterId);
      // Le righe si spostano: la provenienza di pannelli e beat segue, o la
      // prossima revisione confronterebbe numeri di riga sbagliati.
      const remapped = remapProvenance(doc, command.chapterId, command.text);
      return {
        ...remapped,
        scripts: { ...doc.scripts, [command.chapterId]: command.text },
        revisions: { ...doc.revisions, [command.chapterId]: { ...revs, script: { file: `script/${command.chapterId}.md`, sha: command.sha } } },
      };
    }
    case "page.move": {
      requirePage(doc, command.pageId);
      const chapter = chapterOf(doc, command.pageId);
      const ids = chapter.pages.filter((id) => id !== command.pageId);
      const to = Math.max(0, Math.min(ids.length, command.toIndex));
      ids.splice(to, 0, command.pageId);
      return withChapterPages(doc, chapter.id, ids, { ...doc.pages });
    }
  }
}

/** Etichetta leggibile, per il menu Modifica e per il tooltip di undo. */
export function describeCommand(command: Command): string {
  switch (command.type) {
    case "balloon.move":
      return command.target ? `Sposta balloon (${command.target})` : "Sposta balloon";
    case "balloon.tail":
      return "Sposta coda";
    case "balloon.text":
      return "Modifica testo";
    case "balloon.update":
      return "Modifica balloon";
    case "balloon.scale":
      return command.target ? `Corpo del balloon (${command.target})` : "Corpo del balloon";
    case "balloon.reset":
      return `Ripristina balloon (${command.target})`;
    case "balloon.add":
      return "Aggiungi balloon";
    case "balloon.remove":
      return "Elimina balloon";
    case "panel.update":
      return "Modifica pannello";
    case "panel.camera":
      return "Cambia camera";
    case "panel.merge":
      return "Unisci pannelli";
    case "panel.split":
      return command.axis === "cols" ? "Dividi pannello in verticale" : "Dividi pannello in orizzontale";
    case "layout.tracks":
      return "Sposta gutter";
    case "layout.gutter":
      return "Cambia gutter";
    case "page.add":
      return "Aggiungi pagina";
    case "page.remove":
      return "Elimina pagina";
    case "page.move":
      return "Sposta pagina";
    case "revision.add":
      return command.entries.length === 1 ? "Importa una correzione" : `Importa ${command.entries.length} correzioni`;
    case "revision.apply":
      return command.ids.length === 1 ? "Applica correzione" : `Applica ${command.ids.length} correzioni`;
    case "revision.reject":
      return command.ids.length === 1 ? "Rifiuta correzione" : `Rifiuta ${command.ids.length} correzioni`;
    case "script.set":
      return "Aggiorna il copione";
    case "text.replace":
      return `Sostituisci «${command.find}»`;
    case "character.rename":
      return `Rinomina ${command.from} in ${command.to}`;
    case "project.style":
      return "Cambia lo stile del progetto";
    case "character.upsert":
      return `Scheda di ${command.ref}`;
    case "character.remove":
      return `Togli la scheda di ${command.ref}`;
  }
}
