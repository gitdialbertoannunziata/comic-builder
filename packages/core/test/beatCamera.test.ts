import { describe, expect, it } from "vitest";
import { cameraForBeat, beatWantsEmptyPanel } from "../src/script/beatCamera.js";
import { CameraSchema } from "../src/schema/camera.js";
import { BeatFunctionSchema, type BeatFunction } from "../src/schema/scenes.js";

const ALL_FUNCTIONS = BeatFunctionSchema.options;

describe("cameraForBeat — tabella beat→camera (§6.2)", () => {
  it.each(ALL_FUNCTIONS)("«%s» produce una camera valida secondo lo schema", (fn) => {
    expect(() => CameraSchema.parse(cameraForBeat(fn))).not.toThrow();
    expect(() => CameraSchema.parse(cameraForBeat(fn, { intense: true }))).not.toThrow();
  });

  it("è deterministica: stessi input, stessa camera", () => {
    for (const fn of ALL_FUNCTIONS) {
      expect(cameraForBeat(fn, { dialogueTurn: 3 })).toEqual(cameraForBeat(fn, { dialogueTurn: 3 }));
    }
  });

  // Le righe della tabella, una per una.
  it("stabilire luogo/scena: LS, high, 24mm — intenso: dutch", () => {
    expect(cameraForBeat("establish")).toMatchObject({ shot: "LS", angle: "high", lens_mm: 24 });
    expect(cameraForBeat("establish", { intense: true })).toMatchObject({ angle: "dutch" });
  });

  it("ingresso personaggio: MLS, eye, 35mm — intenso: low", () => {
    expect(cameraForBeat("entrance")).toMatchObject({ shot: "MLS", angle: "eye", lens_mm: 35 });
    expect(cameraForBeat("entrance", { intense: true })).toMatchObject({ angle: "low" });
  });

  it("dialogo: MCU, ots, 85mm — intenso: CU", () => {
    expect(cameraForBeat("dialogue")).toMatchObject({ shot: "MCU", angle: "ots", lens_mm: 85 });
    expect(cameraForBeat("dialogue", { intense: true })).toMatchObject({ shot: "CU" });
  });

  it("reazione interiore: CU con dof shallow — intenso: INSERT", () => {
    expect(cameraForBeat("reaction")).toMatchObject({ shot: "CU", dof: "shallow" });
    expect(cameraForBeat("reaction", { intense: true })).toMatchObject({ shot: "INSERT" });
  });

  it("rivelazione: LS — intenso: ECU + dutch", () => {
    expect(cameraForBeat("reveal")).toMatchObject({ shot: "LS" });
    expect(cameraForBeat("reveal", { intense: true })).toMatchObject({ shot: "ECU", angle: "dutch" });
  });

  it("azione: MS, low, 24mm — intenso: motion implied", () => {
    expect(cameraForBeat("action")).toMatchObject({ shot: "MS", angle: "low", lens_mm: 24, motion: "static" });
    expect(cameraForBeat("action", { intense: true })).toMatchObject({ motion: "implied" });
  });

  it("chiusura: LS static — intenso: EWS e pannello senza personaggi", () => {
    expect(cameraForBeat("close")).toMatchObject({ shot: "LS", motion: "static" });
    expect(cameraForBeat("close", { intense: true })).toMatchObject({ shot: "EWS" });
    expect(beatWantsEmptyPanel("close", true)).toBe(true);
    expect(beatWantsEmptyPanel("close", false)).toBe(false);
    expect(beatWantsEmptyPanel("dialogue", true)).toBe(false);
  });

  it("alterna axis_side fra botta e risposta — supporto alla regola dei 180° (§6.4)", () => {
    const turns = [0, 1, 2, 3].map((t) => cameraForBeat("dialogue", { dialogueTurn: t }).axis_side);
    expect(turns).toEqual(["A-left", "A-right", "A-left", "A-right"]);
  });

  it("mood e lighting arrivano dalla scena e sovrascrivono i default della tabella", () => {
    const camera = cameraForBeat("dialogue", { mood: "dread", lighting: "night" });
    expect(camera).toMatchObject({ mood: "dread", lighting: "night", shot: "MCU" });
  });

  it("non lascia mai mood o axis_side nel prompt: restano campi del documento (§6.1)", () => {
    // Verifica di coerenza del contratto: entrambi sono sempre valorizzati,
    // così il lint di continuità ha sempre una base su cui lavorare.
    for (const fn of ALL_FUNCTIONS) {
      const camera = cameraForBeat(fn as BeatFunction);
      expect(camera.mood).toBeTruthy();
      expect(camera.axis_side).toBeTruthy();
    }
  });
});
