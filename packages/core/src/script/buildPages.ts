import type { Page } from "../schema/page.js";
import type { Panel, PanelCharacter } from "../schema/panel.js";
import type { Balloon } from "../schema/balloon.js";
import type { Scene, Beat } from "../schema/scenes.js";
import type { Camera, Shot } from "../schema/camera.js";
import type { ReadingDirection } from "../schema/common.js";
import { expandTemplate } from "../templates/expand.js";
import { cameraForBeat, beatWantsEmptyPanel } from "./beatCamera.js";
import { paginateBeats, chooseTemplate } from "./paginate.js";
import { pageId, panelId, balloonId } from "./ids.js";

export interface BuildPagesInput {
  chapterId: string;
  scene: Scene;
  /** Numero della prima pagina prodotta per questa scena dentro il capitolo. */
  firstPageNumber: number;
  primaryTarget: string;
  gutter: { x: number; y: number };
  readingDirection: ReadingDirection;
}

/**
 * L'inquadratura decide quanto del personaggio si vede: derivarlo dallo shot
 * evita che spoglio e disegno dicano cose diverse sullo stesso pannello.
 */
function framingForShot(shot: Shot): PanelCharacter["framing"] {
  switch (shot) {
    case "EWS":
    case "LS":
    case "MLS":
      return "full-body";
    case "MS":
    case "MCU":
      return "head-and-torso";
    case "CU":
    case "ECU":
      return "head-only";
    case "INSERT":
      return "hands-only";
  }
}

function charactersForPanel(scene: Scene, camera: Camera, empty: boolean): PanelCharacter[] {
  if (empty) return [];
  return scene.characters.map((ref, index) => ({
    ref,
    weight: index === 0 ? 0.7 : 0.4,
    role: index === 0 ? ("lead" as const) : ("support" as const),
    framing: framingForShot(camera.shot),
    // Lasciata vuota apposta: l'espressione è una scelta di regia che lo
    // spoglio non può dedurre dal testo senza inventarsela.
    expression: "",
    wardrobe: "default",
  }));
}

/**
 * Posizione di partenza dei balloon nel pannello. Le ancore sono normalizzate
 * e l'ampiezza del balloon dipende dal lettering, che a questo livello non è
 * ancora stato calcolato: questi valori sono un punto di partenza ragionevole
 * da spostare nell'editor (F2), non una impaginazione definitiva.
 */
function balloonAnchor(index: number, direction: ReadingDirection): { x: number; y: number } {
  return {
    x: direction === "rtl" ? 0.45 : 0.06,
    y: Math.min(0.06 + index * 0.22, 0.8),
  };
}

function balloonsForBeat(beat: Beat, panelIdValue: string, direction: ReadingDirection): Balloon[] {
  return beat.lines.map((line, index) => ({
    id: balloonId(panelIdValue, index + 1),
    type: line.type,
    speaker: { ref: line.speaker, visible: line.speaker !== null, offscreen_dir: null },
    text: [{ t: line.text }],
    anchor: balloonAnchor(index, direction),
    // Nessun `target`: la bocca dello speaker non è nota a questo livello, e
    // inventarne una sarebbe peggio del default del renderer (§8.2).
    tail: { mode: "auto" as const },
    size_mode: "grow" as const,
    font_scale: 1,
    per_target: {},
    z: 2,
    rev: 1,
  }));
}

/**
 * Costruisce le pagine di una scena: beat → pannelli, con camera derivata dalla
 * tabella di §6.2, template scelto dal catalogo e id stabili (§5.3).
 *
 * Tutto qui dentro è deterministico: dato lo stesso `scenes.json` si ottiene lo
 * stesso documento, byte per byte. L'unica parte non deterministica di F1 è lo
 * spoglio che *produce* le scene, ed è confinata dietro `LlmService` (§11.1).
 */
export function buildPagesFromScene(input: BuildPagesInput): Page[] {
  const { scene, chapterId, readingDirection } = input;
  const chunkSizes = paginateBeats(scene.beats.length);

  const pages: Page[] = [];
  let beatCursor = 0;
  // Il turno di dialogo prosegue attraverso i salti di pagina: la regola dei
  // 180° riguarda la scena, non il foglio (§6.4).
  let dialogueTurn = 0;

  chunkSizes.forEach((size, chunkIndex) => {
    const beats = scene.beats.slice(beatCursor, beatCursor + size);
    const pageNumber = input.firstPageNumber + chunkIndex;
    const currentPageId = pageId(chapterId, pageNumber);
    const panelIds = beats.map((_, i) => panelId(currentPageId, i + 1));

    const template = chooseTemplate(beats);
    const { layout, areas } = expandTemplate(template, panelIds, {
      primaryTarget: input.primaryTarget,
      gutter: input.gutter,
      readingDirection,
    });

    const panels: Panel[] = beats.map((beat, i) => {
      const camera = cameraForBeat(beat.function, {
        intense: beat.intense,
        ...(beat.function === "dialogue" ? { dialogueTurn: dialogueTurn++ } : {}),
      });
      const area = areas[i]!;
      const id = panelIds[i]!;

      return {
        id,
        scene_id: scene.id,
        beat_index: beatCursor + i,
        source: beat.source,
        area: { ...area, z: 0 },
        border: { style: "solid", width: 3, radius: 0 },
        camera,
        action: beat.summary,
        setting: `${scene.location}, ${scene.time_of_day}`,
        props: [],
        continuity_notes: "",
        characters: charactersForPanel(scene, camera, beatWantsEmptyPanel(beat.function, beat.intense)),
        art: { source: null, status: "missing" },
        prompt: { override: null, negative_override: null },
        control_image: null,
        seed: { mode: "auto", value: null, epoch: 0 },
        render: {},
        balloons: balloonsForBeat(beat, id, readingDirection),
      };
    });

    pages.push({
      schema: 1,
      id: currentPageId,
      chapter_id: chapterId,
      order: pageNumber,
      spread_with: null,
      layout,
      variants: {},
      panels,
      overlays: [],
    });

    beatCursor += size;
  });

  return pages;
}
