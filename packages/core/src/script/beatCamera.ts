import type { Camera, AxisSide } from "../schema/camera.js";
import type { BeatFunction } from "../schema/scenes.js";

/**
 * Tabella beat→camera (§6.2). È il contratto con il modello, non un
 * suggerimento in prosa: "riduce la varianza in modo misurabile e rende
 * l'output verificabile". Deterministica e pura — stessi input, stessa camera.
 *
 * L'autore può sovrascrivere ogni campo: questa funzione produce il punto di
 * partenza, non l'ultima parola (§6.2).
 */

export interface BeatCameraContext {
  /** Variante "beat intenso" della tabella: cambia shot/angle/motion a seconda della funzione. */
  intense?: boolean;
  /**
   * Turno nello scambio di dialogo (0, 1, 2…): serve ad alternare `axis_side`
   * fra botta e risposta, che è il supporto alla regola dei 180° (§6.4).
   */
  dialogueTurn?: number;
  /** Tono della scena: non entra mai nel prompt, governa palette e composizione (§6.1). */
  mood?: Camera["mood"];
  lighting?: Camera["lighting"];
}

const BASE: Omit<Camera, "shot" | "angle" | "lens_mm"> = {
  dof: "deep",
  lighting: "flat",
  mood: "calm",
  motion: "static",
  subject_placement: "center",
  axis_side: "A-left",
};

function alternatingAxis(turn: number): AxisSide {
  return turn % 2 === 0 ? "A-left" : "A-right";
}

export function cameraForBeat(fn: BeatFunction, context: BeatCameraContext = {}): Camera {
  const intense = context.intense ?? false;
  const camera = ((): Camera => {
    switch (fn) {
      // Stabilire luogo/scena: EWS/LS, high, 24mm — intenso: dutch.
      case "establish":
        return {
          ...BASE,
          shot: "LS",
          angle: intense ? "dutch" : "high",
          lens_mm: 24,
          subject_placement: "none",
        };

      // Ingresso personaggio: MLS, eye, 35mm — intenso: low.
      case "entrance":
        return {
          ...BASE,
          shot: "MLS",
          angle: intense ? "low" : "eye",
          lens_mm: 35,
          subject_placement: "left-third",
        };

      // Dialogo A↔B: MCU, ots, 85mm, alternando axis_side — intenso: CU.
      case "dialogue":
        return {
          ...BASE,
          shot: intense ? "CU" : "MCU",
          angle: "ots",
          lens_mm: 85,
          subject_placement: "two-shot",
          axis_side: alternatingAxis(context.dialogueTurn ?? 0),
        };

      // Reazione interiore: CU/ECU, shallow — intenso: INSERT su oggetto.
      case "reaction":
        return {
          ...BASE,
          shot: intense ? "INSERT" : "CU",
          angle: "eye",
          lens_mm: 85,
          dof: "shallow",
          subject_placement: intense ? "none" : "center",
        };

      // Rivelazione: LS con soggetto piccolo — intenso: ECU + dutch.
      case "reveal":
        return {
          ...BASE,
          shot: intense ? "ECU" : "LS",
          angle: intense ? "dutch" : "eye",
          lens_mm: intense ? 85 : 24,
          subject_placement: intense ? "center" : "right-third",
        };

      // Azione: MS, low, 24mm — intenso: motion implied.
      case "action":
        return {
          ...BASE,
          shot: "MS",
          angle: "low",
          lens_mm: 24,
          motion: intense ? "implied" : "static",
          mood: "action",
        };

      // Chiusura o pausa: LS/EWS, static — intenso: pannello vuoto, senza personaggi.
      case "close":
        return {
          ...BASE,
          shot: intense ? "EWS" : "LS",
          angle: "eye",
          lens_mm: 35,
          motion: "static",
          subject_placement: "none",
        };
    }
  })();

  // mood e lighting arrivano dalla scena, non dalla funzione del beat: la
  // tabella governa l'inquadratura, non il tono e la luce del luogo.
  return {
    ...camera,
    ...(context.mood ? { mood: context.mood } : {}),
    ...(context.lighting ? { lighting: context.lighting } : {}),
  };
}

/**
 * La variante "intenso" della tabella per `close` non è una scelta di camera ma
 * di contenuto: "pannello vuoto, senza personaggi" (§6.2). Il costruttore della
 * pagina lo usa per non popolare `characters` su quel pannello.
 */
export function beatWantsEmptyPanel(fn: BeatFunction, intense: boolean): boolean {
  return fn === "close" && intense;
}
