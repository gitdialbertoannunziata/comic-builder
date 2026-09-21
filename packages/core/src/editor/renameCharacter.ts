import type { ProjectDoc } from "../document/projectDoc.js";

/**
 * Rinomina globale di un personaggio (§10.3): «se il nome cambia a metà
 * serie servono find/replace su testi e riferimenti, non trecento modifiche
 * a mano». Qui i riferimenti — chi parla, chi è in vignetta, il cast delle
 * scene e dei beat — in tutto il progetto. Il testo delle battute che
 * nominano il personaggio è un'altra cosa e passa da trova/sostituisci,
 * dove ogni cambio è una correzione tracciata.
 *
 * Solo ciò che cambia viene ricopiato: pagine e scene senza quel personaggio
 * restano gli stessi oggetti, e il salvataggio non le riscrive.
 */
export function renameCharacterRefs(doc: ProjectDoc, from: string, to: string): ProjectDoc {
  const pages: Record<string, ProjectDoc["pages"][string]> = {};
  let pagesChanged = false;
  for (const [id, page] of Object.entries(doc.pages)) {
    let changed = false;
    const panels = page.panels.map((panel) => {
      const touches = panel.characters.some((c) => c.ref === from) || panel.balloons.some((b) => b.speaker.ref === from);
      if (!touches) return panel;
      changed = true;
      return {
        ...panel,
        characters: panel.characters.map((c) => (c.ref === from ? { ...c, ref: to } : c)),
        balloons: panel.balloons.map((b) => (b.speaker.ref === from ? { ...b, speaker: { ...b.speaker, ref: to } } : b)),
      };
    });
    const overlaysTouched = page.overlays.some((b) => b.speaker.ref === from);
    const overlays = overlaysTouched ? page.overlays.map((b) => (b.speaker.ref === from ? { ...b, speaker: { ...b.speaker, ref: to } } : b)) : page.overlays;
    changed ||= overlaysTouched;
    pages[id] = changed ? { ...page, panels, overlays } : page;
    pagesChanged ||= changed;
  }

  let scenesChanged = false;
  const scenes = doc.scenes.scenes.map((scene) => {
    const touches =
      scene.characters.includes(from) ||
      scene.beats.some((b) => b.lines.some((l) => l.speaker === from) || (b.characters ?? []).some((c) => c.ref === from));
    if (!touches) return scene;
    scenesChanged = true;
    return {
      ...scene,
      characters: scene.characters.map((c) => (c === from ? to : c)),
      beats: scene.beats.map((beat) => ({
        ...beat,
        lines: beat.lines.map((l) => (l.speaker === from ? { ...l, speaker: to } : l)),
        characters: beat.characters ? beat.characters.map((c) => (c.ref === from ? { ...c, ref: to } : c)) : beat.characters,
      })),
    };
  });

  return {
    ...doc,
    pages: pagesChanged ? pages : doc.pages,
    scenes: scenesChanged ? { ...doc.scenes, scenes } : doc.scenes,
  };
}

/** Tutti i ref di personaggio usati nel progetto: per proporre la rinomina e per rifiutare una collisione. */
export function characterRefs(doc: ProjectDoc): Set<string> {
  const refs = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      panel.characters.forEach((c) => refs.add(c.ref));
      panel.balloons.forEach((b) => b.speaker.ref && refs.add(b.speaker.ref));
    }
  }
  for (const scene of doc.scenes.scenes) scene.characters.forEach((c) => refs.add(c));
  return refs;
}
