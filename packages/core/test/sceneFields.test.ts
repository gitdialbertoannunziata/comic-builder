import { describe, expect, it } from "vitest";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { cameraForBeat } from "../src/script/beatCamera.js";
import { SceneSchema, type Scene } from "../src/schema/scenes.js";

const BUILD = {
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr" as const,
};

function scene(overrides: Record<string, unknown> = {}, beats: Record<string, unknown>[] = []): Scene {
  return SceneSchema.parse({
    id: "s001",
    title: "Il faro",
    location: "scogliera",
    time_of_day: "alba",
    characters: ["sara", "elio"],
    beats: beats.length
      ? beats
      : [
          { id: "b1", function: "establish", summary: "Il faro vuoto." },
          { id: "b2", function: "dialogue", summary: "Parlano." },
          { id: "b3", function: "close", summary: "Chiusura." },
        ],
    ...overrides,
  });
}

function panels(s: Scene) {
  return buildPagesFromScene({ ...BUILD, scene: s }).flatMap((p) => p.panels);
}

describe("Personaggi per beat — la vignetta vuota resta vuota", () => {
  it("un beat che dichiara nessuno in vignetta produce un pannello senza personaggi", () => {
    // Il difetto corretto: prima il campo lungo sul faro vuoto chiedeva di
    // disegnarci sara ed elio, perché ogni pannello riceveva tutto il cast.
    const result = panels(
      scene({}, [
        { id: "b1", function: "establish", summary: "Il faro vuoto.", characters: [] },
        { id: "b2", function: "dialogue", summary: "Parlano." },
        { id: "b3", function: "close", summary: "Chiusura." },
      ]),
    );
    expect(result[0]!.characters).toEqual([]);
  });

  it("un beat che dichiara chi c'è mostra solo quelli, con l'espressione", () => {
    const result = panels(
      scene({}, [
        { id: "b1", function: "establish", summary: "x" },
        { id: "b2", function: "reaction", summary: "Sara capisce.", characters: [{ ref: "sara", expression: "sgomenta" }] },
        { id: "b3", function: "close", summary: "x" },
      ]),
    );
    expect(result[1]!.characters.map((c) => [c.ref, c.expression])).toEqual([["sara", "sgomenta"]]);
  });

  it("solo un beat che non lo sa (null) eredita il cast della scena", () => {
    const result = panels(scene());
    expect(result[1]!.characters.map((c) => c.ref)).toEqual(["sara", "elio"]);
  });
});

describe("Tono e luce della scena arrivano alla camera", () => {
  it("la luce della scena finisce in ogni pannello, invece di flat ovunque", () => {
    const result = panels(scene({ lighting: "golden" }));
    expect(result.every((p) => p.camera.lighting === "golden")).toBe(true);
  });

  it("il tono della scena finisce nei pannelli", () => {
    const result = panels(scene({ mood: "tense" }));
    expect(result[0]!.camera.mood).toBe("tense");
  });

  it("il tono del beat prevale su quello della scena", () => {
    const result = panels(
      scene({ mood: "calm" }, [
        { id: "b1", function: "establish", summary: "x" },
        { id: "b2", function: "reveal", summary: "La lente non c'è più.", mood: "dread" },
        { id: "b3", function: "close", summary: "x" },
      ]),
    );
    expect(result[0]!.camera.mood).toBe("calm");
    expect(result[1]!.camera.mood).toBe("dread");
  });

  it("gli oggetti del beat arrivano al pannello", () => {
    const result = panels(
      scene({}, [
        { id: "b1", function: "establish", summary: "x", props: ["lanterna", "quadro elettrico"] },
        { id: "b2", function: "dialogue", summary: "x" },
        { id: "b3", function: "close", summary: "x" },
      ]),
    );
    expect(result[0]!.props).toEqual(["lanterna", "quadro elettrico"]);
  });
});

describe("Precedenza del tono (§6.1): beat → tabella → scena", () => {
  it("il tono esplicito del beat vince su tutto, anche sulla tabella", () => {
    expect(cameraForBeat("action", { mood: "grief", sceneMood: "tense" }).mood).toBe("grief");
  });

  it("il tono legato alla funzione vince su quello della scena", () => {
    // Un beat d'azione è `action` anche in una scena `tense`.
    expect(cameraForBeat("action", { sceneMood: "tense" }).mood).toBe("action");
  });

  it("il tono della scena vale dove né beat né tabella dicono altro", () => {
    expect(cameraForBeat("dialogue", { sceneMood: "tense" }).mood).toBe("tense");
  });

  it("senza indicazioni resta il default neutro", () => {
    expect(cameraForBeat("dialogue").mood).toBe("calm");
  });
});

describe("Il costume scelto nel beat arriva al pannello", () => {
  it("wardrobe del beat → wardrobe del personaggio in vignetta", () => {
    const result = panels(
      scene({}, [
        { id: "b1", function: "establish", summary: "x", characters: [{ ref: "sara", expression: "", wardrobe: "notte" }] },
        { id: "b2", function: "dialogue", summary: "x" },
        { id: "b3", function: "close", summary: "x" },
      ]),
    );
    expect(result[0]!.characters[0]).toMatchObject({ ref: "sara", wardrobe: "notte" });
    expect(result[1]!.characters.every((c) => c.wardrobe === "default")).toBe(true);
  });
});
