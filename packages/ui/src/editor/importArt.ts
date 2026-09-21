import { artPathFor, extensionOf, isArtFile, type Command, type Panel, type ProjectDoc, type ProjectStore } from "@comic-builder/core";

/**
 * Collega un'immagine a un pannello: la copia in `art/<id-pannello>.<ext>`
 * e la dichiara come arte del pannello. Il nome è l'id, così il collegamento
 * regge da solo anche se si rilegge la cartella da zero (vedi `artCommands`).
 * Una sola funzione per il pulsante e per il trascinamento sulla pagina.
 */
export async function importArt(
  store: ProjectStore,
  run: (command: Command) => boolean,
  pageId: string,
  panel: Panel,
  file: File,
): Promise<string | null> {
  if (!isArtFile(file.name)) return `«${file.name}»: formati accettati PNG, JPEG, WebP. Esporta da lì il file sorgente (PSD, CLIP, KRA).`;
  const path = artPathFor(panel.id, extensionOf(file.name));
  await store.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
  // Collegamento esplicito: vince su qualunque collegamento per nome precedente.
  run({
    type: "panel.update",
    pageId,
    panelId: panel.id,
    patch: { art: { source: path, status: panel.art.status === "missing" ? "sketch" : panel.art.status, sha: null } },
  });
  return null;
}

/** Il pannello (e la sua pagina) che si chiama come il file: `ep001-p001-03.png` → `ep001-p001-03`. */
export function panelForFileName(doc: ProjectDoc, name: string): { pageId: string; panel: Panel } | null {
  const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
  for (const page of Object.values(doc.pages)) {
    const panel = page.panels.find((p) => p.id.toLowerCase() === stem);
    if (panel) return { pageId: page.id, panel };
  }
  return null;
}
