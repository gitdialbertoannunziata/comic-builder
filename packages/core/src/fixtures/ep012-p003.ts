import type { Page } from "../schema/page.js";
import type { Balloon } from "../schema/balloon.js";

type PanelCharacter = Page["panels"][number]["characters"][number];

function character(
  ref: string,
  weight: number,
  role: PanelCharacter["role"],
  framing: PanelCharacter["framing"],
  expression: string,
): PanelCharacter {
  return { ref, weight, role, framing, expression, wardrobe: "default" };
}

function camera(overrides: Partial<Page["panels"][number]["camera"]> = {}) {
  return {
    shot: "MS" as const,
    angle: "eye" as const,
    lens_mm: 35 as const,
    dof: "deep" as const,
    lighting: "flat" as const,
    mood: "calm" as const,
    motion: "static" as const,
    subject_placement: "center" as const,
    axis_side: "A-left" as const,
    ...overrides,
  };
}

function basePanel(id: string, area: Page["panels"][number]["area"]) {
  return {
    id,
    scene_id: "s014",
    beat_index: 0,
    area,
    border: { style: "solid" as const, width: 3, radius: 0 },
    art: { source: null, status: "missing" as const },
    seed: { mode: "auto" as const, value: null, epoch: 0 },
    props: [],
    continuity_notes: "",
    characters: [],
    balloons: [],
  };
}

/**
 * Pagina a 6 pannelli scritta a mano (criterio d'uscita F0, §12): griglia 3x3 con
 * alternanza 1/3 + 2/3 per riga (classic-6, §7.3), che tassella senza buchi né
 * sovrapposizioni non dichiarate.
 */
export const ep012p003: Page = {
  schema: 1,
  id: "ep012-p003",
  chapter_id: "ep012",
  order: 3,
  spread_with: null,
  layout: {
    mode: "page",
    primary_target: "digital-page",
    template_id: "classic-6",
    cols: [1, 1, 1],
    rows: [1, 1, 0.8],
    gutter: { x: 14, y: 18 },
    reading_order: [
      "ep012-p003-01",
      "ep012-p003-02",
      "ep012-p003-03",
      "ep012-p003-04",
      "ep012-p003-05",
      "ep012-p003-06",
    ],
  },
  variants: {
    "webtoon-strip": {
      status: "derived",
      slice: {
        max_height: 1280,
        min_height: 640,
        seam: "none",
        avoid: ["balloons"],
        prefer: "gutter",
        overlap_px: 8,
      },
      balloon_overrides: [],
    },
  },
  overlays: [],
  panels: [
    {
      ...basePanel("ep012-p003-01", { col: 0, row: 0, col_span: 1, row_span: 1, z: 0 }),
      camera: camera({ shot: "LS", angle: "high" }),
      action: "Il garage vuoto, polvere controluce",
      setting: "garage, sera",
    },
    {
      ...basePanel("ep012-p003-02", { col: 1, row: 0, col_span: 2, row_span: 1, z: 0 }),
      camera: camera({ shot: "MLS", angle: "eye" }),
      action: "Marco si avvicina alla porta basculante",
      setting: "garage, sera",
      characters: [character("marco", 0.6, "lead", "full-body", "teso")],
    },
    {
      ...basePanel("ep012-p003-03", { col: 0, row: 1, col_span: 2, row_span: 1, z: 0 }),
      camera: camera({ shot: "MS", angle: "low", lighting: "backlit", mood: "tense" }),
      action: "Marco spinge la porta del garage e si ferma",
      setting: "garage, polvere sospesa, sera",
      props: ["porta basculante", "auto coperta da un telo"],
      continuity_notes: "giacca strappata al gomito sinistro da ep012-p002",
      characters: [character("marco", 0.75, "lead", "head-and-torso", "teso")],
      balloons: [
        {
          id: "ep012-p003-03-b1",
          type: "speech",
          speaker: { ref: "marco", visible: true, offscreen_dir: null },
          text: [
            { t: "Non c'è più " },
            { t: "niente", em: "bold" },
            { t: " qui dentro." },
          ],
          anchor: { x: 0.22, y: 0.15 },
          tail: { mode: "auto", target: { x: 0.4, y: 0.62 } },
          size_mode: "grow",
          font_scale: 1.0,
          per_target: {
            "webtoon-strip": { anchor: { x: 0.3, y: 0.72 }, font_scale: 1.15 },
          },
          z: 2,
          rev: 3,
        } satisfies Balloon,
      ],
    },
    {
      ...basePanel("ep012-p003-04", { col: 2, row: 1, col_span: 1, row_span: 1, z: 0 }),
      camera: camera({ shot: "CU", angle: "eye", dof: "shallow" }),
      action: "Primo piano sugli occhi di Marco",
      setting: "garage, sera",
      characters: [character("marco", 0.9, "lead", "head-only", "sorpreso")],
    },
    {
      ...basePanel("ep012-p003-05", { col: 0, row: 2, col_span: 1, row_span: 1, z: 0 }),
      camera: camera({ shot: "INSERT", subject_placement: "none" }),
      action: "Dettaglio: chiave appesa al chiodo, vuota accanto",
      setting: "garage, sera",
    },
    {
      ...basePanel("ep012-p003-06", { col: 1, row: 2, col_span: 2, row_span: 1, z: 0 }),
      camera: camera({ shot: "LS", angle: "eye", motion: "static" }),
      action: "Marco esce lentamente, richiude la porta alle spalle",
      setting: "garage, sera",
      characters: [character("marco", 0.5, "lead", "full-body", "rassegnato")],
    },
  ].map((p) => ({
    prompt: { override: null, negative_override: null },
    control_image: null,
    render: {},
    source: null,
    ...p,
  })),
};
