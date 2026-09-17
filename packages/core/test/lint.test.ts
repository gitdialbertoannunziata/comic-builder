import { describe, expect, it } from "vitest";
import { lintPage } from "../src/validate/lint.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { sampleScene } from "../src/fixtures/sample-scene.js";
import { PageSchema, type Page } from "../src/schema/page.js";
import { SceneSchema } from "../src/schema/scenes.js";
import type { Shot, AxisSide } from "../src/schema/camera.js";

interface PanelSpec {
  shot?: Shot;
  angle?: "eye" | "low" | "high" | "dutch";
  axis?: AxisSide;
  setting?: string;
  speaker?: string | null;
  text?: string;
  characters?: string[];
  balloonCount?: number;
}

/** Pagina sintetica su misura per una regola: il lint si prova a colpo sicuro. */
function pageWith(specs: PanelSpec[]): Page {
  return PageSchema.parse({
    schema: 1,
    id: "lint-page",
    chapter_id: "lint",
    order: 1,
    layout: {
      mode: "page",
      primary_target: "digital-page",
      cols: Array.from({ length: specs.length }, () => 1),
      rows: [1],
      gutter: { x: 10, y: 10 },
      reading_order: specs.map((_, i) => `p${i + 1}`),
    },
    panels: specs.map((spec, i) => {
      const characters = spec.characters ?? (spec.speaker ? [spec.speaker] : []);
      const count = spec.balloonCount ?? (spec.speaker !== undefined ? 1 : 0);
      return {
        id: `p${i + 1}`,
        scene_id: "s1",
        beat_index: i,
        area: { col: i, row: 0 },
        border: { style: "solid", width: 3 },
        camera: {
          shot: spec.shot ?? "MS",
          angle: spec.angle ?? "eye",
          lens_mm: 35,
          dof: "deep",
          lighting: "flat",
          mood: "calm",
          motion: "static",
          subject_placement: "center",
          axis_side: spec.axis ?? "A-left",
        },
        action: "",
        setting: spec.setting ?? "luogo",
        characters: characters.map((ref) => ({
          ref,
          weight: 0.6,
          role: "lead",
          framing: "head-and-torso",
          expression: "",
        })),
        art: { source: null, status: "missing" },
        seed: { mode: "auto", value: null, epoch: 0 },
        balloons: Array.from({ length: count }, (_, b) => ({
          id: `p${i + 1}-b${b + 1}`,
          type: "speech",
          speaker: { ref: spec.speaker ?? null, visible: spec.speaker != null },
          text: [{ t: spec.text ?? "battuta" }],
          anchor: { x: 0.1, y: 0.1 + b * 0.1 },
          tail: { mode: "auto" },
          size_mode: "grow",
          font_scale: 1,
          z: 2,
          rev: 1,
        })),
      };
    }),
  });
}

function codes(page: Page): string[] {
  return lintPage(page).map((i) => i.code);
}

describe("lintPage — ritmo della camera (§6.3, Appendice A)", () => {
  it("segnala tre o più pannelli consecutivi con lo stesso shot", () => {
    const page = pageWith([{ shot: "CU" }, { shot: "CU" }, { shot: "CU" }, { shot: "LS" }]);
    expect(codes(page)).toContain("camera.repeated-shot");
  });

  it("tollera due pannelli consecutivi con lo stesso shot", () => {
    const page = pageWith([{ shot: "CU" }, { shot: "CU" }, { shot: "LS" }]);
    expect(codes(page)).not.toContain("camera.repeated-shot");
  });

  it("segnala una pagina senza nessun campo largo né dettaglio", () => {
    const page = pageWith([{ shot: "CU" }, { shot: "MCU" }, { shot: "ECU" }]);
    expect(codes(page)).toContain("camera.no-wide-shot");
  });

  it("non la segnala se c'è almeno un LS o un INSERT", () => {
    const page = pageWith([{ shot: "CU" }, { shot: "INSERT" }, { shot: "ECU" }]);
    expect(codes(page)).not.toContain("camera.no-wide-shot");
  });

  it("segnala un jump cut: stesso shot, stesso angolo, stesso setting di fila", () => {
    const page = pageWith([
      { shot: "MS", angle: "eye", setting: "cucina" },
      { shot: "MS", angle: "eye", setting: "cucina" },
      { shot: "LS" },
    ]);
    expect(codes(page)).toContain("camera.jump-cut");
  });

  it("non chiama jump cut un cambio di luogo con la stessa inquadratura", () => {
    const page = pageWith([
      { shot: "MS", angle: "eye", setting: "cucina" },
      { shot: "MS", angle: "eye", setting: "strada" },
      { shot: "LS" },
    ]);
    expect(codes(page)).not.toContain("camera.jump-cut");
  });

  it("non chiama jump cut un campo/controcampo: stessa inquadratura, asse opposto", () => {
    // È esattamente ciò che la tabella beat→camera prescrive per il dialogo
    // (§6.2): senza questa eccezione il lint contraddirebbe il generatore.
    const page = pageWith([
      { shot: "MCU", angle: "eye", setting: "cucina", axis: "A-left" },
      { shot: "MCU", angle: "eye", setting: "cucina", axis: "A-right" },
      { shot: "LS" },
    ]);
    expect(codes(page)).not.toContain("camera.jump-cut");
  });

  it("segnala l'abuso dell'angolo dutch nella stessa pagina", () => {
    const page = pageWith([{ angle: "dutch" }, { angle: "dutch" }, { angle: "dutch" }, { shot: "LS" }]);
    expect(codes(page)).toContain("camera.dutch-overuse");
  });
});

describe("lintPage — regola dei 180° (§6.4)", () => {
  it("segnala uno scambio ripreso dallo stesso lato dell'asse", () => {
    const page = pageWith([
      { speaker: "sara", axis: "A-left", shot: "MCU" },
      { speaker: "elio", axis: "A-left", shot: "CU" },
    ]);
    expect(codes(page)).toContain("camera.axis-break");
  });

  it("tace quando lo scambio alterna i lati, come fa la tabella beat→camera", () => {
    const page = pageWith([
      { speaker: "sara", axis: "A-left", shot: "MCU" },
      { speaker: "elio", axis: "A-right", shot: "CU" },
    ]);
    expect(codes(page)).not.toContain("camera.axis-break");
  });

  it("non si applica quando a parlare è sempre la stessa persona", () => {
    const page = pageWith([
      { speaker: "sara", axis: "A-left", shot: "MCU" },
      { speaker: "sara", axis: "A-left", shot: "CU" },
    ]);
    expect(codes(page)).not.toContain("camera.axis-break");
  });
});

describe("lintPage — balloon (Appendice A)", () => {
  it("segnala come errore uno speaker che non compare nel pannello", () => {
    const page = pageWith([{ speaker: "sconosciuto", characters: ["sara"], shot: "LS" }]);
    const issues = lintPage(page);
    const unknown = issues.find((i) => i.code === "balloon.unknown-speaker");
    expect(unknown?.level).toBe("error");
  });

  it("accetta uno speaker fuori campo se il balloon è marcato offpanel", () => {
    const page = pageWith([{ speaker: "elio", characters: ["sara"], shot: "LS" }]);
    page.panels[0]!.balloons[0]!.type = "offpanel";
    expect(codes(page)).not.toContain("balloon.unknown-speaker");
  });

  it("segnala un testo oltre la soglia utile", () => {
    const page = pageWith([{ speaker: "sara", text: "a".repeat(221), shot: "LS" }]);
    expect(codes(page)).toContain("balloon.text-too-long");
  });

  it("segnala un pannello con più di tre balloon", () => {
    const page = pageWith([{ speaker: "sara", balloonCount: 4, shot: "LS" }]);
    expect(codes(page)).toContain("balloon.crowded-panel");
  });

  it("segnala come errore un'ancora fuori da [0,1]", () => {
    const page = pageWith([{ speaker: "sara", shot: "LS" }]);
    page.panels[0]!.balloons[0]!.anchor.x = 1.4;
    const issues = lintPage(page);
    expect(issues.find((i) => i.code === "balloon.anchor-out-of-range")?.level).toBe("error");
  });
});

describe("lintPage — griglia, produzione e contenuto", () => {
  it("segnala un numero di pannelli fuori dall'intervallo consigliato", () => {
    expect(codes(pageWith([{ shot: "LS" }, { shot: "CU" }]))).toContain("grid.panel-count");
    expect(codes(pageWith([{ shot: "LS" }, { shot: "CU" }, { shot: "MS" }]))).not.toContain("grid.panel-count");
  });

  it("segnala i pannelli ancora senza arte", () => {
    const page = pageWith([{ shot: "LS" }, { shot: "CU" }, { shot: "MS" }]);
    const missing = lintPage(page).find((i) => i.code === "production.missing-art");
    expect(missing?.level).toBe("info");
    expect(missing?.message).toContain("3 pannelli");
  });

  it("segnala un personaggio della scena assente dalla pagina", () => {
    const page = pageWith([{ characters: ["sara"], shot: "LS" }, { shot: "CU" }, { shot: "MS" }]);
    const scene = SceneSchema.parse({
      id: "s1",
      title: "t",
      location: "l",
      time_of_day: "sera",
      characters: ["sara", "elio"],
      beats: [],
    });
    const issues = lintPage(page, { scene });
    const absent = issues.find((i) => i.code === "content.absent-character");
    expect(absent?.message).toContain("elio");
  });
});

describe("lintPage sul documento che lo spoglio produce davvero", () => {
  const pages = buildPagesFromScene({
    chapterId: "ep001",
    scene: sampleScene,
    firstPageNumber: 1,
    primaryTarget: "digital-page",
    gutter: { x: 14, y: 18 },
    readingDirection: "ltr",
  });

  it("non produce errori bloccanti: lo spoglio genera documenti sani", () => {
    for (const page of pages) {
      const errors = lintPage(page, { scene: sampleScene }).filter((i) => i.level === "error");
      expect(errors).toEqual([]);
    }
  });

  it("segnala comunque l'arte mancante, che è lo stato reale del documento", () => {
    const issues = lintPage(pages[0]!, { scene: sampleScene });
    expect(issues.map((i) => i.code)).toContain("production.missing-art");
  });

  it("la tabella beat→camera non viola da sola la regola dei 180°", () => {
    for (const page of pages) {
      expect(lintPage(page).map((i) => i.code)).not.toContain("camera.axis-break");
    }
  });

  it("né produce jump cut: generatore e lint non si contraddicono", () => {
    for (const page of pages) {
      expect(lintPage(page).map((i) => i.code)).not.toContain("camera.jump-cut");
    }
  });
});
