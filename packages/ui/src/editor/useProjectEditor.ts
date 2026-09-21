import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireLock,
  canRedo,
  canUndo,
  CommandError,
  createHistory,
  endGesture as endHistoryGesture,
  execute,
  loadProject,
  PROJECT_FILE,
  redo as redoHistory,
  redoLabel,
  refreshLock,
  releaseLock,
  replaceDocument,
  saveProject,
  undo as undoHistory,
  undoLabel,
  type Command,
  type History,
  type ProjectDoc,
  type ProjectStore,
  type ValidationIssue,
} from "@comic-builder/core";
import { BrowserProjectStore, canOpenFolders, pickFolder } from "../platform/browserProjectStore.js";

/**
 * Lo stato dell'editor: il documento con la sua cronologia, la cartella su
 * cui vive, e il salvataggio automatico.
 *
 * L'autosave non è un timer che salva tutto: salva ciò che è cambiato
 * rispetto all'ultimo stato scritto, confrontando i riferimenti (§11.3), un
 * attimo dopo che l'utente ha smesso di modificare. Spostare un balloon
 * riscrive un file di pagina, non il progetto.
 */
export type SaveStatus =
  | { kind: "memory" }
  | { kind: "saved"; at: Date }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "locked-out"; message: string };

const AUTOSAVE_DELAY_MS = 700;
const LOCK_REFRESH_MS = 45_000;

const session = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const holder = (() => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${browser} (comic-builder)`;
})();

export interface ProjectEditor {
  doc: ProjectDoc;
  history: History;
  folder: string | null;
  status: SaveStatus;
  /** Esiti dell'apertura (pagine mancanti, file orfani, salvataggio recuperato). */
  loadIssues: ValidationIssue[];
  /** Ultimo comando rifiutato, col suo messaggio: la UI lo mostra e lo lascia sparire. */
  notice: string | null;
  canOpenFolders: boolean;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  undoLabel: string | null;
  redoLabel: string | null;
  canUndo: boolean;
  canRedo: boolean;
  replace: (doc: ProjectDoc, label: string) => void;
  openFolder: () => Promise<void>;
  saveToFolder: () => Promise<void>;
  dismissNotice: () => void;
}

export function useProjectEditor(initial: ProjectDoc): ProjectEditor {
  const [history, setHistory] = useState<History>(() => createHistory(initial));
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [saved, setSaved] = useState<ProjectDoc | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: "memory" });
  const [loadIssues, setLoadIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const historyRef = useRef(history);

  /**
   * Ogni transizione passa di qui, sul riferimento corrente e in modo
   * sincrono: durante un trascinamento arrivano più eventi prima del render
   * successivo, e ognuno deve partire dallo stato lasciato dal precedente.
   */
  const commit = useCallback((change: (h: History) => History) => {
    const next = change(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
  }, []);

  const run = useCallback(
    (command: Command, options: { gesture?: string } = {}) => {
      try {
        commit((h) => execute(h, command, options));
        return true;
      } catch (error) {
        // Un comando rifiutato non è un crash: è un "non si può" da dire all'utente.
        if (error instanceof CommandError) {
          setNotice(error.message);
          return false;
        }
        throw error;
      }
    },
    [commit],
  );

  const endGesture = useCallback(() => commit(endHistoryGesture), [commit]);
  const undo = useCallback(() => commit(undoHistory), [commit]);
  const redo = useCallback(() => commit(redoHistory), [commit]);
  const replace = useCallback((doc: ProjectDoc, label: string) => commit((h) => replaceDocument(h, doc, label)), [commit]);

  // --- Autosave: solo ciò che è cambiato, un attimo dopo l'ultima modifica ---
  const saving = useRef(false);
  useEffect(() => {
    if (!store || status.kind === "locked-out") return;
    if (history.present === saved) return;
    setStatus((s) => (s.kind === "saving" ? s : { kind: "pending" }));
    const timer = setTimeout(() => {
      if (saving.current) return;
      saving.current = true;
      setStatus({ kind: "saving" });
      const target = history.present;
      saveProject(store, target, saved)
        .then(() => {
          setSaved(target);
          setStatus({ kind: "saved", at: new Date() });
        })
        .catch((error: unknown) => setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          saving.current = false;
        });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [history.present, saved, store, status.kind]);

  // --- Lock: rinnovato finché la sessione è aperta, rilasciato alla chiusura ---
  useEffect(() => {
    if (!store) return;
    const interval = setInterval(() => {
      void refreshLock(store, session, holder, new Date()).then((result) => {
        if (!result.acquired) {
          setStatus({
            kind: "locked-out",
            message: `Il progetto è stato aperto da ${result.held.holder}: salvataggio automatico sospeso per non sovrascriverlo.`,
          });
        }
      });
    }, LOCK_REFRESH_MS);
    const release = () => void releaseLock(store, session);
    window.addEventListener("pagehide", release);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [store]);

  // Chiudere la scheda con modifiche non salvate: il browser chiede conferma.
  const dirty = store ? history.present !== saved : history.past.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // --- Scorciatoie: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y ---
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      // Vale anche dentro i campi di testo: sono controllati dal documento, e
      // l'undo nativo del browser lì dentro non saprebbe nulla dei comandi.
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  async function claim(next: ProjectStore): Promise<boolean> {
    const lock = await acquireLock(next, session, holder, new Date());
    if (lock.acquired) return true;
    const since = new Date(lock.held.at).toLocaleTimeString();
    const proceed = window.confirm(
      `Questo progetto risulta aperto da ${lock.held.holder} (ultimo segnale alle ${since}).\n\n` +
        "Se lo apri anche qui, le due finestre si sovrascriveranno a vicenda. Aprire lo stesso?",
    );
    if (!proceed) return false;
    await acquireLock(next, session, holder, new Date(), { force: true });
    return true;
  }

  async function openFolder() {
    const handle = await pickFolder();
    if (!handle) return;
    const next = new BrowserProjectStore(handle);
    try {
      const result = await loadProject(next);
      if (!(await claim(next))) return;
      if (store) await releaseLock(store, session);
      commit(() => createHistory(result.doc));
      setSaved(result.doc);
      setStore(next);
      setLoadIssues(result.issues);
      setStatus({ kind: "saved", at: new Date() });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveToFolder() {
    const handle = await pickFolder();
    if (!handle) return;
    const next = new BrowserProjectStore(handle);
    try {
      if ((await next.readText(PROJECT_FILE)) !== null) {
        const overwrite = window.confirm(
          `La cartella "${handle.name}" contiene già un progetto. Sostituirlo con quello aperto qui?\n\n` +
            "Per lavorare su quello esistente, usa invece «Apri».",
        );
        if (!overwrite) return;
      }
      if (!(await claim(next))) return;
      const doc = historyRef.current.present;
      setStatus({ kind: "saving" });
      await saveProject(next, doc, null);
      if (store) await releaseLock(store, session);
      setStore(next);
      setSaved(doc);
      setLoadIssues([]);
      setStatus({ kind: "saved", at: new Date() });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    doc: history.present,
    history,
    folder: store?.label ?? null,
    status,
    loadIssues,
    notice,
    canOpenFolders: canOpenFolders(),
    run,
    endGesture,
    undo,
    redo,
    undoLabel: undoLabel(history),
    redoLabel: redoLabel(history),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    replace,
    openFolder,
    saveToFolder,
    dismissNotice: () => setNotice(null),
  };
}
