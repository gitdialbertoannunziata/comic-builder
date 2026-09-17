import type { Page } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Balloon } from "../schema/balloon.js";
import type { ValidationIssue } from "../validate/issue.js";
import { repairPage } from "../validate/repair.js";

/**
 * Merge a tre vie del re-run dello spoglio (§10.3).
 *
 * Le tre versioni sono quelle che il piano nomina: **base** (quello che il
 * generatore aveva prodotto l'ultima volta), **incoming** (la nuova proposta)
 * e **current** (il documento come l'autore l'ha modificato a mano).
 *
 * La regola è una sola e vale per ogni campo:
 *
 * - l'autore non l'ha toccato (base = current) → si accetta la proposta;
 * - il generatore non l'ha cambiato (base = incoming) → resta la modifica a mano;
 * - l'hanno cambiato entrambi → **conflitto**: si tiene la modifica a mano e la
 *   proposta finisce nell'elenco da approvare.
 *
 * L'ultimo punto è la garanzia che il piano chiede: "rigenerare una scena non
 * sovrascrive le modifiche a mano". Il default non è mai perdere il lavoro
 * dell'autore — nel dubbio la proposta si mostra, non si applica.
 *
 * Non serve dichiarare quali campi appartengano al generatore e quali
 * all'autore: la regola lo deduce da sola. L'arte importata a mano sopravvive
 * perché il generatore emette lo stesso default in base e in incoming, quindi
 * ricade nel secondo caso.
 */

export interface MergeConflict {
  path: string;
  panelId?: string;
  balloonId?: string;
  /** Il valore dell'ultima generazione. */
  base: unknown;
  /** Quello che il re-run propone. */
  incoming: unknown;
  /** Quello che l'autore ha scritto, e che resta nel documento. */
  current: unknown;
}

export interface MergeChange {
  path: string;
  panelId?: string;
  balloonId?: string;
  from: unknown;
  to: unknown;
}

export interface MergeResult {
  /** Documento risultante: proposte accettate dove non c'era lavoro a mano, modifiche a mano ovunque altrove. */
  merged: Page;
  /** Proposte applicate senza ambiguità. */
  changes: MergeChange[];
  /** Proposte non applicate, da approvare una per una. */
  conflicts: MergeConflict[];
  /** Riparazioni deterministiche applicate dopo il merge, da mostrare e non da nascondere. */
  repairs: ValidationIssue[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]));
}

interface MergeAccumulator {
  changes: MergeChange[];
  conflicts: MergeConflict[];
}

interface FieldLocation {
  path: string;
  panelId?: string;
  balloonId?: string;
}

/** Il cuore del merge: una decisione per campo, sempre la stessa. */
function mergeField<T>(base: T, incoming: T, current: T, at: FieldLocation, acc: MergeAccumulator): T {
  if (deepEqual(incoming, current)) return current;

  if (deepEqual(base, current)) {
    acc.changes.push({ ...at, from: current, to: incoming });
    return incoming;
  }

  if (deepEqual(base, incoming)) return current;

  acc.conflicts.push({ ...at, base, incoming, current });
  return current;
}

const PANEL_FIELDS = [
  "scene_id",
  "beat_index",
  "source",
  "area",
  "border",
  "camera",
  "action",
  "setting",
  "props",
  "continuity_notes",
  "characters",
  "art",
  "prompt",
  "control_image",
  "seed",
  "render",
] as const;

const BALLOON_FIELDS = [
  "type",
  "speaker",
  "text",
  "anchor",
  "tail",
  "size_mode",
  "font_scale",
  "per_target",
  "z",
  "rev",
] as const;

function mergeBalloons(
  base: Panel | undefined,
  incoming: Panel,
  current: Panel,
  acc: MergeAccumulator,
): Balloon[] {
  const baseById = new Map((base?.balloons ?? []).map((b) => [b.id, b]));
  const incomingById = new Map(incoming.balloons.map((b) => [b.id, b]));
  const currentById = new Map(current.balloons.map((b) => [b.id, b]));

  const merged: Balloon[] = [];

  for (const currentBalloon of current.balloons) {
    const baseBalloon = baseById.get(currentBalloon.id);
    const incomingBalloon = incomingById.get(currentBalloon.id);

    if (!incomingBalloon) {
      // Il re-run non lo propone più: la battuta è sparita dallo script.
      if (baseBalloon && deepEqual(baseBalloon, currentBalloon)) {
        acc.changes.push({
          path: `balloons[${currentBalloon.id}]`,
          panelId: current.id,
          balloonId: currentBalloon.id,
          from: currentBalloon,
          to: null,
        });
        continue;
      }
      // Toccato a mano (o nato a mano): non si cancella in silenzio.
      if (baseBalloon) {
        acc.conflicts.push({
          path: `balloons[${currentBalloon.id}]`,
          panelId: current.id,
          balloonId: currentBalloon.id,
          base: baseBalloon,
          incoming: null,
          current: currentBalloon,
        });
      }
      merged.push(currentBalloon);
      continue;
    }

    const result = { ...currentBalloon } as Record<string, unknown>;
    for (const field of BALLOON_FIELDS) {
      result[field] = mergeField(
        baseBalloon?.[field],
        incomingBalloon[field],
        currentBalloon[field],
        {
          path: `balloons[${currentBalloon.id}].${field}`,
          panelId: current.id,
          balloonId: currentBalloon.id,
        },
        acc,
      );
    }
    merged.push(result as unknown as Balloon);
  }

  // Battute nuove proposte dal re-run.
  for (const incomingBalloon of incoming.balloons) {
    if (currentById.has(incomingBalloon.id)) continue;
    if (baseById.has(incomingBalloon.id)) continue; // cancellata a mano: resta cancellata
    acc.changes.push({
      path: `balloons[${incomingBalloon.id}]`,
      panelId: current.id,
      balloonId: incomingBalloon.id,
      from: null,
      to: incomingBalloon,
    });
    merged.push(incomingBalloon);
  }

  return merged;
}

function mergePanel(
  base: Panel | undefined,
  incoming: Panel,
  current: Panel,
  acc: MergeAccumulator,
): Panel {
  const result = { ...current } as Record<string, unknown>;

  for (const field of PANEL_FIELDS) {
    result[field] = mergeField(
      base?.[field],
      incoming[field],
      current[field],
      { path: `panels[${current.id}].${field}`, panelId: current.id },
      acc,
    );
  }

  result.balloons = mergeBalloons(base, incoming, current, acc);
  return result as unknown as Panel;
}

const PAGE_FIELDS = ["order", "spread_with", "layout", "variants", "overlays"] as const;

export function mergeRerun(base: Page, incoming: Page, current: Page): MergeResult {
  const acc: MergeAccumulator = { changes: [], conflicts: [] };

  const baseById = new Map(base.panels.map((p) => [p.id, p]));
  const incomingById = new Map(incoming.panels.map((p) => [p.id, p]));
  const currentById = new Map(current.panels.map((p) => [p.id, p]));

  const panels: Panel[] = [];

  for (const currentPanel of current.panels) {
    const basePanel = baseById.get(currentPanel.id);
    const incomingPanel = incomingById.get(currentPanel.id);

    if (!incomingPanel) {
      // Il beat che generava questo pannello non c'è più nello script.
      if (basePanel && deepEqual(basePanel, currentPanel)) {
        acc.changes.push({ path: `panels[${currentPanel.id}]`, panelId: currentPanel.id, from: currentPanel, to: null });
        continue;
      }
      // È stato lavorato a mano: toglierlo in silenzio sarebbe esattamente la
      // distruzione che questo merge esiste per impedire.
      if (basePanel) {
        acc.conflicts.push({
          path: `panels[${currentPanel.id}]`,
          panelId: currentPanel.id,
          base: basePanel,
          incoming: null,
          current: currentPanel,
        });
      }
      panels.push(currentPanel);
      continue;
    }

    panels.push(mergePanel(basePanel, incomingPanel, currentPanel, acc));
  }

  // Pannelli nuovi: beat aggiunti allo script dopo l'ultima generazione.
  for (const incomingPanel of incoming.panels) {
    if (currentById.has(incomingPanel.id)) continue;
    if (baseById.has(incomingPanel.id)) continue; // cancellato a mano: resta cancellato
    acc.changes.push({ path: `panels[${incomingPanel.id}]`, panelId: incomingPanel.id, from: null, to: incomingPanel });
    panels.push(incomingPanel);
  }

  const merged = { ...current, panels } as Record<string, unknown>;
  for (const field of PAGE_FIELDS) {
    merged[field] = mergeField(base[field], incoming[field], current[field], { path: field }, acc);
  }

  // Il merge può lasciare l'ordine di lettura disallineato: succede quando il
  // lay-out ritoccato a mano vince il conflitto ma il re-run ha aggiunto o
  // tolto pannelli. La riparazione lo ricompone invece di restituire un
  // documento che non passerebbe validateDocument.
  const { page: repaired, repairs } = repairPage(merged as unknown as Page);

  return { merged: repaired, changes: acc.changes, conflicts: acc.conflicts, repairs };
}
