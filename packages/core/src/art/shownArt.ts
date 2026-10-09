import type { ArtFrame, ImageSize, Panel } from "../schema/panel.js";
import type { PanelPatch } from "../editor/commands.js";

/**
 * L'immagine che il pannello mostra: l'arte dell'autore, che vince sempre,
 * oppure il render del target (§5.7). Chi la disegna e chi la inquadra non
 * deve sapere da dove viene: dimensioni e inquadratura stanno con
 * l'immagine, in `art` o nel record del render.
 */
export interface ShownArt {
  kind: "art" | "render";
  file: string;
  /** Null finché non le si è lette: senza, si ripiega sul riempimento centrato e non si inquadra. */
  size: ImageSize | null;
  frame: ArtFrame | undefined;
}

export function shownArt(panel: Pick<Panel, "art" | "render">, target: string): ShownArt | null {
  if (panel.art.source) return { kind: "art", file: panel.art.source, size: panel.art.size ?? null, frame: panel.art.frame };
  const record = panel.render[target];
  return record ? { kind: "render", file: record.file, size: record.size ?? null, frame: record.frame } : null;
}

/**
 * La patch che cambia l'inquadratura dell'immagine mostrata, per
 * `panel.update`. `size` registra le dimensioni lette adesso, se l'immagine
 * non le aveva (un render di prima che si registrassero). Null se il
 * pannello non mostra niente.
 */
export function shownArtPatch(panel: Pick<Panel, "art" | "render">, target: string, frame: ArtFrame, size?: ImageSize | null): PanelPatch | null {
  if (panel.art.source) return { art: { ...panel.art, ...(size && !panel.art.size ? { size } : {}), frame } };
  const record = panel.render[target];
  if (!record) return null;
  return { render: { ...panel.render, [target]: { ...record, ...(size && !record.size ? { size } : {}), frame } } };
}
