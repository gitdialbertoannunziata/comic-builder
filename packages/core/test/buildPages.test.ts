import { describe, expect, it } from "vitest";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { paginateBeats } from "../src/script/paginate.js";
import { validateDocument } from "../src/validate/validateDocument.js";
import { PageSchema } from "../src/schema/page.js";
import { SceneSchema, type Scene } from "../src/schema/scenes.js";
import { nextPanelId, nextBalloonId, panelId, pageId, balloonId } from "../src/script/ids.js";
import type { BeatFunction } from "../src/schema/scenes.js";

function scene(functions: BeatFunction[], overrides: Partial<Scene> = {}): Scene {
  return SceneSchema.parse({
    id: "s001",
    title: "Il faro",
    location: "cima del faro",
    time_of_day: "alba",
    characters: ["sara", "elio"],
    beats: functions.map((fn, i) => ({
      id: `s001-b${i + 1}`,
      function: fn,
      summary: `beat ${i + 1}`,
    })),
    ...overrides,
  });
}

const BUILD_OPTIONS = {
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr" as const,
};

describe("buildPagesFromScene — criterio d'uscita F1: documento sensato e valido", () => {
  it("produce pagine che passano lo schema e validateDocument, per ogni lunghezza di scena", () => {
    for (let n = 1; n <= 20; n++) {
      const functions: BeatFunction[] = Array.from({ length: n }, (_, i) =>
        i === 0 ? "establish" : i === n - 1 ? "close" : "dialogue",
      );
      const pages = buildPagesFromScene({ ...BUILD_OPTIONS, scene: scene(functions) });

      expect(pages).toHaveLength(paginateBeats(n).length);
      for (const page of pages) {
        expect(() => PageSchema.parse(page)).not.toThrow();
        expect(validateDocument(page)).toEqual([]);
      }
    }
  });

  it("copre tutti i beat della scena, una volta sola e in ordine", () => {
    const pages = buildPagesFromScene({
      ...BUILD_OPTIONS,
      scene: scene(["establish", "entrance", "dialogue", "dialogue", "reaction", "reveal", "action", "close"]),
    });
    const beatIndexes = pages.flatMap((p) => p.panels.map((panel) => panel.beat_index));
    expect(beatIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("deriva id stabili da capitolo, pagina e indice (§5.3)", () => {
    const pages = buildPagesFromScene({
      ...BUILD_OPTIONS,
      scene: scene(["establish", "dialogue", "close"]),
    });

    expect(pages[0]!.id).toBe(pageId("ep001", 1));
    expect(pages[0]!.id).toBe("ep001-p001");
    expect(pages[0]!.panels.map((p) => p.id)).toEqual([
      "ep001-p001-01",
      "ep001-p001-02",
      "ep001-p001-03",
    ]);
    expect(pages[0]!.layout.mode === "page" && pages[0]!.layout.reading_order).toEqual(
      pages[0]!.panels.map((p) => p.id),
    );
  });

  it("numera le pagine a partire da firstPageNumber, con order separato dall'id (§5.4)", () => {
    const pages = buildPagesFromScene({
      ...BUILD_OPTIONS,
      firstPageNumber: 7,
      scene: scene(Array.from({ length: 10 }, () => "dialogue" as BeatFunction)),
    });
    expect(pages.map((p) => p.id)).toEqual(["ep001-p007", "ep001-p008"]);
    expect(pages.map((p) => p.order)).toEqual([7, 8]);
  });

  it("è deterministica: stessa scena, stesso documento", () => {
    const input = { ...BUILD_OPTIONS, scene: scene(["establish", "dialogue", "reaction", "close"]) };
    expect(JSON.stringify(buildPagesFromScene(input))).toBe(JSON.stringify(buildPagesFromScene(input)));
  });

  it("deriva la camera dalla tabella e alterna axis_side attraverso i salti di pagina (§6.4)", () => {
    // Otto beat di dialogo: 4+4, quindi l'alternanza deve proseguire sulla seconda pagina.
    const pages = buildPagesFromScene({
      ...BUILD_OPTIONS,
      scene: scene(Array.from({ length: 8 }, () => "dialogue" as BeatFunction)),
    });
    const axes = pages.flatMap((p) => p.panels.map((panel) => panel.camera.axis_side));
    expect(axes).toEqual([
      "A-left", "A-right", "A-left", "A-right",
      "A-left", "A-right", "A-left", "A-right",
    ]);
  });

  it("trasforma le battute del beat in balloon, con speaker e id derivati", () => {
    const withLines = scene(["dialogue", "dialogue", "close"]);
    withLines.beats[0]!.lines = [
      { speaker: "sara", text: "La lanterna è spenta.", type: "speech" },
      { speaker: "elio", text: "Da quanto?", type: "speech" },
    ];

    const pages = buildPagesFromScene({ ...BUILD_OPTIONS, scene: withLines });
    const panel = pages[0]!.panels[0]!;

    expect(panel.balloons).toHaveLength(2);
    expect(panel.balloons[0]!.id).toBe(balloonId(panel.id, 1));
    expect(panel.balloons[0]!.speaker).toMatchObject({ ref: "sara", visible: true });
    expect(panel.balloons[0]!.text).toEqual([{ t: "La lanterna è spenta." }]);
    // Ancore diverse: due balloon nello stesso pannello non si sovrappongono di default.
    expect(panel.balloons[0]!.anchor.y).not.toBe(panel.balloons[1]!.anchor.y);
    // Nessun target della coda: la bocca dello speaker non è nota allo spoglio (§8.2).
    expect(panel.balloons[0]!.tail.target).toBeUndefined();
  });

  it("una battuta senza speaker produce un balloon con speaker non visibile", () => {
    const withCaption = scene(["establish", "dialogue", "close"]);
    withCaption.beats[0]!.lines = [{ speaker: null, text: "Tre anni prima.", type: "caption" }];

    const pages = buildPagesFromScene({ ...BUILD_OPTIONS, scene: withCaption });
    const balloon = pages[0]!.panels[0]!.balloons[0]!;
    expect(balloon.type).toBe("caption");
    expect(balloon.speaker).toMatchObject({ ref: null, visible: false });
  });

  it("propaga la provenienza dallo script al pannello (§10.1)", () => {
    const withSource = scene(["establish", "dialogue", "close"]);
    withSource.beats[1]!.source = { file: "script/cap-001.md", from_line: 12, to_line: 20 };

    const pages = buildPagesFromScene({ ...BUILD_OPTIONS, scene: withSource });
    expect(pages[0]!.panels[1]!.source).toEqual({ file: "script/cap-001.md", from_line: 12, to_line: 20 });
    expect(pages[0]!.panels[0]!.source).toBeNull();
  });

  it("un beat di chiusura intenso produce un pannello senza personaggi (§6.2)", () => {
    const withIntenseClose = scene(["establish", "dialogue", "close"]);
    withIntenseClose.beats[2]!.intense = true;

    const pages = buildPagesFromScene({ ...BUILD_OPTIONS, scene: withIntenseClose });
    const panels = pages[0]!.panels;
    expect(panels[2]!.characters).toEqual([]);
    expect(panels[0]!.characters.map((c) => c.ref)).toEqual(["sara", "elio"]);
  });

  it("deriva il framing del personaggio dallo shot, così spoglio e disegno concordano", () => {
    const pages = buildPagesFromScene({
      ...BUILD_OPTIONS,
      scene: scene(["establish", "reaction", "dialogue"]),
    });
    const panels = pages[0]!.panels;
    expect(panels[0]!.camera.shot).toBe("LS");
    expect(panels[0]!.characters[0]!.framing).toBe("full-body");
    expect(panels[1]!.camera.shot).toBe("CU");
    expect(panels[1]!.characters[0]!.framing).toBe("head-only");
  });

  it("specchia il lay-out per una serie che si legge da destra a sinistra", () => {
    const ltr = buildPagesFromScene({ ...BUILD_OPTIONS, scene: scene(["establish", "dialogue", "close"]) });
    const rtl = buildPagesFromScene({
      ...BUILD_OPTIONS,
      readingDirection: "rtl",
      scene: scene(["establish", "dialogue", "close"]),
    });

    expect(rtl[0]!.panels.map((p) => p.id)).toEqual(ltr[0]!.panels.map((p) => p.id));
    expect(rtl[0]!.panels[0]!.area.col).not.toBe(ltr[0]!.panels[0]!.area.col);
    expect(validateDocument(rtl[0]!)).toEqual([]);
  });
});

describe("ids — stabili e non posizionali (§5.3)", () => {
  it("deriva gli id da coordinate locali, non da un contatore globale", () => {
    expect(pageId("ep012", 3)).toBe("ep012-p003");
    expect(panelId("ep012-p003", 3)).toBe("ep012-p003-03");
    expect(balloonId("ep012-p003-03", 1)).toBe("ep012-p003-03-b1");
  });

  it("non riusa un id già speso, anche se il pannello che lo portava non c'è più", () => {
    expect(nextPanelId("ep012-p003", ["ep012-p003-01", "ep012-p003-02"])).toBe("ep012-p003-03");
    // "-02" è stato cancellato ma resta speso: riusarlo farebbe puntare una voce
    // di changelog scritta per il vecchio pannello a un pannello nuovo e diverso.
    expect(nextPanelId("ep012-p003", ["ep012-p003-01", "ep012-p003-03"])).toBe("ep012-p003-04");
  });

  it("assegna il primo id a una pagina ancora vuota", () => {
    expect(nextPanelId("ep012-p003", [])).toBe("ep012-p003-01");
    expect(nextBalloonId("ep012-p003-01", [])).toBe("ep012-p003-01-b1");
  });

  it("ignora gli id di altre pagine quando calcola il prossimo", () => {
    const mixed = ["ep012-p003-01", "ep012-p004-09", "ep012-p003-02"];
    expect(nextPanelId("ep012-p003", mixed)).toBe("ep012-p003-03");
  });
});
