import { z } from "zod";
import { BeatFunctionSchema, BalloonTypeSchema, MoodSchema, LightingSchema } from "@comic-builder/core";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Il contratto di output dello spoglio.
 *
 * È volutamente **più stretto** del modello dati del progetto: al modello si
 * chiede il minimo indispensabile e tutto il resto si deriva. In particolare
 * non si chiedono gli id (si derivano da capitolo e indice, §5.3, e devono
 * essere stabili — un id inventato dal modello non lo sarebbe) né la camera,
 * che esce dalla tabella beat→camera in modo deterministico (§6.2). Il modello
 * decide solo la *funzione* del beat: sette valori chiusi, verificabili.
 *
 * Meno si chiede, più l'output è affidabile, e meno c'è da riparare a valle.
 */

export const BreakdownLineSchema = z.object({
  /** Ref del personaggio che parla, oppure null per didascalie e voce fuori campo. */
  speaker: z.string().nullable(),
  text: z.string(),
  /**
   * Tipo di balloon, nel vocabolario chiuso di §8.2. Senza, ogni battuta
   * diventava `speech` e sussurri, urla, didascalie e voci al telefono si
   * perdevano, anche se il resto della catena sa disegnarli diversamente.
   */
  type: BalloonTypeSchema,
});

export const BreakdownCharacterSchema = z.object({
  ref: z.string(),
  /** Espressione del personaggio in questa vignetta. Stringa vuota se il testo non la suggerisce. */
  expression: z.string(),
});

export const BreakdownBeatSchema = z.object({
  function: BeatFunctionSchema,
  summary: z.string(),
  /** Seleziona la colonna "variante" della tabella beat→camera (§6.2). */
  intense: z.boolean(),
  lines: z.array(BreakdownLineSchema),
  /**
   * Chi è in vignetta. `[]` è un'informazione: nessuno, come in un campo
   * lungo su un luogo vuoto. `null` vuol dire "non lo so", e solo allora il
   * pannello eredita il cast della scena.
   */
  characters: z.array(BreakdownCharacterSchema).nullable(),
  /** Tono del beat se si discosta da quello della scena, altrimenti null. */
  mood: MoodSchema.nullable(),
  /** Oggetti che la vignetta deve mostrare: parte della specifica di disegno (§5.5). */
  props: z.array(z.string()),
  /**
   * Righe dello script da cui il beat nasce (§10.1). Un modello sbaglia spesso
   * i numeri di riga: qui è un'indicazione, e chi riceve la valida contro la
   * lunghezza reale del testo prima di fidarsene.
   */
  from_line: z.number().int().positive(),
  to_line: z.number().int().positive(),
});

export const BreakdownSceneSchema = z.object({
  title: z.string(),
  location: z.string(),
  time_of_day: z.string(),
  /** Ref dei personaggi presenti: minuscolo, senza spazi, stabile fra le scene. */
  characters: z.array(z.string()),
  /** Tono e luce della scena, vocabolario chiuso di §6.1: il modello sceglie, non inventa. */
  mood: MoodSchema,
  lighting: LightingSchema,
  beats: z.array(BreakdownBeatSchema).min(1),
});

export const BreakdownSchema = z.object({
  scenes: z.array(BreakdownSceneSchema).min(1),
});

export type Breakdown = z.infer<typeof BreakdownSchema>;
export type BreakdownScene = z.infer<typeof BreakdownSceneSchema>;
export type BreakdownBeat = z.infer<typeof BreakdownBeatSchema>;

/**
 * Lo stesso schema in JSON Schema, per il decoding vincolato. Derivato e non
 * scritto a mano: uno schema JSON copiato a mano diverge dallo zod alla prima
 * modifica, e diverge in silenzio.
 */
export function breakdownJsonSchema(): Record<string, unknown> {
  // Nessun `name`: passarlo avvolgerebbe tutto in `{$ref, definitions}`, e uno
  // schema che comincia con un $ref è inutilizzabile per costruire una
  // grammatica — il motore vuole la forma inline. `$refStrategy: "none"` da
  // solo non basta, perché riguarda i riferimenti *interni*, non l'involucro.
  return zodToJsonSchema(BreakdownSchema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
}

export const BREAKDOWN_SCHEMA_NAME = "Breakdown";
