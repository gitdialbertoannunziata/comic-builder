import type { ProjectDoc } from "../document/projectDoc.js";
import type { Panel } from "../schema/panel.js";
import type { Command } from "../editor/commands.js";

/**
 * Collegamento fra i pannelli e la cartella `art/` (§5.1: l'arte sorgente
 * dell'autore, mai rigenerata). L'autore disegna fuori — Clip Studio,
 * Krita, carta e scanner — ed esporta con il nome del pannello; lo
 * strumento se ne accorge e la pagina si aggiorna (criterio d'uscita di F2).
 *
 * Tutto qui è puro: chi sorveglia la cartella (l'host) passa cosa ha
 * trovato, e riceve i comandi da applicare. Nessuna euristica sul contenuto
 * delle immagini: il nome è il contratto, dichiarato e verificabile.
 */
export const ART_DIR = "art";
export const ART_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

const MEDIA: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

export function isArtFile(name: string): boolean {
  return (ART_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function artMediaType(path: string): string | null {
  return MEDIA[extensionOf(path)] ?? null;
}

/** Dove va l'arte di un pannello importata dall'editor: il nome è l'id, così il collegamento regge da solo. */
export function artPathFor(panelId: string, extension: string): string {
  return `${ART_DIR}/${panelId}.${extension.toLowerCase().replace(/^\./, "")}`;
}

/** Un file trovato in `art/`, con l'impronta del contenuto calcolata dall'host. */
export interface ArtFile {
  /** Percorso relativo al progetto, es. `art/ep001-p001-03.png`. */
  path: string;
  sha: string;
}

/**
 * Indice per id in minuscolo: su macOS e Windows il filesystem non distingue
 * le maiuscole, e `EP001-P001-03.png` è lo stesso nome per chi lo scrive.
 * Gli id derivati sono tutti minuscoli (§5.3), quindi non nasce ambiguità.
 */
function panelIndex(doc: ProjectDoc): Map<string, { pageId: string; panel: Panel }> {
  const index = new Map<string, { pageId: string; panel: Panel }>();
  for (const page of Object.values(doc.pages)) for (const panel of page.panels) index.set(panel.id.toLowerCase(), { pageId: page.id, panel });
  return index;
}

function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/**
 * Cosa cambia nel documento dato ciò che c'è in `art/`:
 *
 * - un file col nome di un pannello senza arte lo collega (stato `sketch`
 *   se era `missing`: che sia inchiostrato o finito lo dice l'autore);
 * - un file già collegato il cui contenuto è cambiato ne aggiorna lo `sha`
 *   (§9.2: la staleness del ramo manuale);
 * - un pannello già collegato a un altro file non si tocca: il collegamento
 *   esplicito vince su quello per nome.
 *
 * Un file che sparisce non scollega nulla: una cartella sincronizzata a metà
 * o un file rinominato per sbaglio non devono cancellare il lavoro. Il
 * pannello resta collegato, e il renderer dice "arte non trovata".
 */
export function artCommands(doc: ProjectDoc, files: readonly ArtFile[]): Command[] {
  const panels = panelIndex(doc);
  const bySource = new Map<string, { pageId: string; panel: Panel }>();
  for (const entry of panels.values()) if (entry.panel.art.source) bySource.set(entry.panel.art.source, entry);

  const commands: Command[] = [];
  const touched = new Set<string>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!isArtFile(file.path)) continue;

    const linked = bySource.get(file.path);
    if (linked) {
      if (linked.panel.art.sha !== file.sha) {
        commands.push({ type: "panel.update", pageId: linked.pageId, panelId: linked.panel.id, patch: { art: { ...linked.panel.art, sha: file.sha } } });
        touched.add(linked.panel.id);
      }
      continue;
    }

    const byName = panels.get(stem(file.path).toLowerCase());
    if (!byName || byName.panel.art.source !== null || touched.has(byName.panel.id)) continue;
    touched.add(byName.panel.id);
    commands.push({
      type: "panel.update",
      pageId: byName.pageId,
      panelId: byName.panel.id,
      patch: { art: { source: file.path, status: byName.panel.art.status === "missing" ? "sketch" : byName.panel.art.status, sha: file.sha } },
    });
  }
  return commands;
}

/** Pannelli che dichiarano un'arte che l'host non ha trovato. */
export function missingArt(doc: ProjectDoc, available: ReadonlySet<string>): Array<{ pageId: string; panelId: string; source: string }> {
  const out: Array<{ pageId: string; panelId: string; source: string }> = [];
  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      if (panel.art.source && !available.has(panel.art.source)) out.push({ pageId: page.id, panelId: panel.id, source: panel.art.source });
    }
  }
  return out;
}
