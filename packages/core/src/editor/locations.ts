import type { ProjectDoc } from "../document/projectDoc.js";
import type { LocationSheet } from "../schema/locations.js";
import type { Scene } from "../schema/scenes.js";
import { refFromName } from "../revisions/readable.js";

/**
 * I luoghi dell'opera. Le scene li nominano («La stanza»), le schede dicono
 * com'è fatto ognuno: il legame è il nome, ridotto a ref. Lo spoglio usa lo
 * stesso nome per lo stesso posto fra un capitolo e l'altro (gli si passano
 * i luoghi già visti), ed è questo che rende la scheda ritrovabile.
 */

/** «La stanza» → `la_stanza`. Vuoto se il nome non dice niente: una scena «non specificata» non ha un luogo da tenere uguale. */
export function locationRef(name: string): string {
  const ref = refFromName(name);
  return ref === "non_specificato" || ref === "non_specificata" ? "" : ref;
}

/** Il luogo di una scena: il ref, e la scheda se c'è. Null se la scena non ne nomina uno. */
export function sceneLocation(doc: Pick<ProjectDoc, "locations">, scene: Pick<Scene, "location"> | undefined): { ref: string; name: string; sheet: LocationSheet | null } | null {
  if (!scene) return null;
  const ref = locationRef(scene.location);
  if (!ref) return null;
  return { ref, name: scene.location.trim(), sheet: doc.locations[ref] ?? null };
}

export interface ProjectLocation {
  ref: string;
  /** Il nome della scheda, o quello con cui la prima scena lo nomina. */
  name: string;
  sheet: LocationSheet | null;
  /** Le scene ambientate lì, in ordine di documento. */
  scenes: Scene[];
}

/** Tutti i luoghi: quelli che le scene nominano e quelli che hanno solo una scheda. I più usati prima. */
export function projectLocations(doc: Pick<ProjectDoc, "locations" | "scenes">): ProjectLocation[] {
  const byRef = new Map<string, ProjectLocation>();
  for (const scene of doc.scenes.scenes) {
    const ref = locationRef(scene.location);
    if (!ref) continue;
    const entry = byRef.get(ref) ?? { ref, name: doc.locations[ref]?.name || scene.location.trim(), sheet: doc.locations[ref] ?? null, scenes: [] };
    entry.scenes.push(scene);
    byRef.set(ref, entry);
  }
  for (const [ref, sheet] of Object.entries(doc.locations)) {
    if (!byRef.has(ref)) byRef.set(ref, { ref, name: sheet.name || ref, sheet, scenes: [] });
  }
  return [...byRef.values()].sort((a, b) => b.scenes.length - a.scenes.length || a.name.localeCompare(b.name));
}
