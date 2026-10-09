import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { locationRef } from "@comic-builder/core";
import type { LlmService } from "./service.js";
import { LlmError } from "./service.js";

/**
 * I luoghi, descritti per chi disegna. Una scena dice dove siamo («La
 * stanza»); la scheda del luogo dice com'è fatto, ed è ciò che il modello di
 * immagini riceve in ogni vignetta ambientata lì. Senza, il posto si
 * reinventa a ogni vignetta.
 *
 * Due strade portano qui: lo spoglio, che descrive i luoghi del capitolo
 * insieme alle scene, e `describeLocations`, per i luoghi di un'opera già
 * spogliata — senza rifare lo spoglio e perdere ciò che si è fatto dopo.
 */
export const BreakdownPlaceSchema = z.object({
  /** Esattamente il `location` delle scene: è il nome che lega la scheda alle scene. */
  name: z.string(),
  description: z.string(),
});
export type BreakdownPlace = z.infer<typeof BreakdownPlaceSchema>;

/** La regola per descrivere un luogo: la stessa nello spoglio e nella richiesta a parte. */
export const PLACE_RULE =
  "`description` dice com'è fatto il posto, in tre o quattro frasi brevi da scheda, perché un disegnatore lo disegni uguale in ogni vignetta: pianta e dimensioni, arredi e oggetti fissi con la loro posizione (a sinistra, sotto la finestra…), materiali, colori dominanti, da dove viene la luce. Niente persone e niente ora del giorno: quelle sono della scena. Ricava tutto ciò che puoi dal testo e dalle regole della serie; dove tacciono, proponi dettagli plausibili e precisi, coerenti con l'ambientazione. Per un luogo immaginario o mentale descrivi ciò che si vede, con la stessa precisione.";

const LocationsAnswerSchema = z.object({ locations: z.array(BreakdownPlaceSchema) });
export const LOCATIONS_SCHEMA_NAME = "LocationSheets";

export function locationsJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(LocationsAnswerSchema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
}

export interface PlaceToDescribe {
  name: string;
  /** Le scene ambientate lì, in breve: è da qui che il modello capisce com'è fatto. */
  scenes: ReadonlyArray<{ title: string; time_of_day: string; beats: readonly string[] }>;
}

export interface DescribeLocationsInput {
  llm: LlmService;
  places: readonly PlaceToDescribe[];
  /** Le regole della serie: spesso è lì che l'autore ha già descritto i suoi luoghi. */
  notes?: string;
}

const NOTES_START = "Regole della serie:";

export function describeLocationsPrompt(input: Omit<DescribeLocationsInput, "llm">): { system: string; user: string } {
  const system = [
    "Sei lo scenografo di un fumetto. Per ogni luogo elencato scrivi la scheda che i disegnatori useranno per disegnarlo sempre uguale.",
    "",
    `- \`name\` è il nome del luogo esattamente come elencato.`,
    `- ${PLACE_RULE}`,
    "- Scrivi nella lingua delle scene.",
    "",
    "Rispondi esclusivamente con JSON conforme allo schema richiesto, senza commenti né testo attorno.",
  ].join("\n");
  const places = input.places.map((place) => {
    const scenes = place.scenes.slice(0, 6).map((s) => `  · ${s.title} (${s.time_of_day}): ${s.beats.filter(Boolean).slice(0, 4).join(" ")}`);
    return [`- ${place.name}`, ...scenes].join("\n");
  });
  const notes = input.notes?.trim() ? `${NOTES_START}\n${input.notes.trim()}\n\n` : "";
  return { system, user: `${notes}Luoghi da descrivere, con le scene ambientate lì:\n${places.join("\n")}` };
}

/** Le descrizioni, una per luogo chiesto e nello stesso ordine; vuota dove il modello non ne ha data una. */
export async function describeLocations(input: DescribeLocationsInput): Promise<BreakdownPlace[]> {
  if (input.places.length === 0) return [];
  const { system, user } = describeLocationsPrompt(input);
  const response = await input.llm.complete({ system, user, schema: locationsJsonSchema(), schemaName: LOCATIONS_SCHEMA_NAME });
  const parsed = LocationsAnswerSchema.safeParse(response.data);
  if (!parsed.success) throw new LlmError(`Le descrizioni dei luoghi non sono conformi allo schema: ${parsed.error.issues[0]?.message ?? "forma inattesa"}`, input.llm.name);
  // Si accoppiano per ref: il modello può cambiare maiuscole o un accento, non il posto.
  const byRef = new Map(parsed.data.locations.map((p) => [locationRef(p.name), p.description.trim()]));
  return input.places.map((place) => ({ name: place.name, description: byRef.get(locationRef(place.name)) ?? "" }));
}

/**
 * Ciò che l'euristica sa di un luogo senza un modello: la riga delle regole
 * della serie che lo descrive («• La stanza: scrivania, monitor, sedia
 * rossa…»), se l'autore l'ha scritta. Altrimenti niente: non inventa.
 */
export function heuristicLocations(user: string): { locations: BreakdownPlace[] } {
  const [head = "", list = ""] = user.split("Luoghi da descrivere, con le scene ambientate lì:\n");
  const notes = head.startsWith(NOTES_START) ? head.slice(NOTES_START.length) : "";
  const names = list.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  return {
    locations: names.map((name) => {
      const ref = locationRef(name);
      const line = notes.split("\n").find((l) => {
        const [label] = l.replace(/^[\s•*·-]+/, "").split(":");
        return label !== undefined && l.includes(":") && locationRef(label) === ref;
      });
      return { name, description: line ? line.slice(line.indexOf(":") + 1).trim() : "" };
    }),
  };
}
