import type { ProjectDoc } from "../document/projectDoc.js";
import { applyCommand, describeCommand, type Command } from "./commands.js";

/**
 * Undo/redo a più livelli (§11.3).
 *
 * Ogni voce è lo stato *prima* di un comando. Con il documento immutabile e
 * condiviso per struttura, uno stato costa quanto le parti che il comando ha
 * ricopiato — di fatto una patch — e annullare è rimettere un riferimento,
 * senza ricalcolare nulla e senza il rischio di una patch inversa sbagliata.
 */
export interface HistoryEntry {
  doc: ProjectDoc;
  label: string;
}

export interface History {
  past: readonly HistoryEntry[];
  present: ProjectDoc;
  future: readonly HistoryEntry[];
  /** Chiave dell'ultimo gesto registrato, per fonderne i passi (vedi `execute`). */
  lastGesture: string | null;
}

export const HISTORY_LIMIT = 500;

export function createHistory(doc: ProjectDoc): History {
  return { past: [], present: doc, future: [], lastGesture: null };
}

export interface ExecuteOptions {
  /**
   * Identifica un gesto continuo (un trascinamento): tutti i comandi con la
   * stessa chiave, uno dopo l'altro, diventano un solo passo di undo. Senza,
   * spostare un balloon di un centimetro richiederebbe sessanta Ctrl+Z.
   */
  gesture?: string;
}

/** Applica un comando. Se il comando non si può applicare, lancia e la cronologia resta com'era. */
export function execute(history: History, command: Command, options: ExecuteOptions = {}): History {
  const next = applyCommand(history.present, command);
  if (next === history.present) return history;

  const gesture = options.gesture ?? null;
  if (gesture !== null && gesture === history.lastGesture && history.past.length > 0) {
    // Stesso gesto: lo stato "prima" resta quello di inizio gesto.
    return { ...history, present: next, future: [], lastGesture: gesture };
  }

  const past = [...history.past, { doc: history.present, label: describeCommand(command) }];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
    lastGesture: gesture,
  };
}

/** Chiude il gesto in corso: il prossimo comando, anche con la stessa chiave, è un passo nuovo. */
export function endGesture(history: History): History {
  return history.lastGesture === null ? history : { ...history, lastGesture: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undo(history: History): History {
  const last = history.past[history.past.length - 1];
  if (!last) return history;
  return {
    past: history.past.slice(0, -1),
    present: last.doc,
    future: [{ doc: history.present, label: last.label }, ...history.future],
    lastGesture: null,
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, { doc: history.present, label: next.label }],
    present: next.doc,
    future: history.future.slice(1),
    lastGesture: null,
  };
}

/** Etichette per il menu: "Annulla Sposta balloon". */
export function undoLabel(history: History): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

export function redoLabel(history: History): string | null {
  return history.future[0]?.label ?? null;
}

/**
 * Sostituisce il documento senza passare da un comando — per esempio dopo
 * un nuovo spoglio o un'importazione — conservando la possibilità di
 * tornare indietro.
 */
export function replaceDocument(history: History, doc: ProjectDoc, label: string): History {
  return {
    past: [...history.past, { doc: history.present, label }].slice(-HISTORY_LIMIT),
    present: doc,
    future: [],
    lastGesture: null,
  };
}
