import type { ProjectDoc } from "@comic-builder/core";
import type { DirectoryHandle } from "./browserProjectStore.js";

/**
 * Ciò che deve sopravvivere a un F5, in IndexedDB: la cartella del progetto
 * aperto (un handle di File System Access si può conservare, il permesso a
 * volte va richiesto di nuovo) e, per un progetto non ancora salvato, il
 * lavoro della scheda — documento e immagini caricate.
 *
 * Ogni accesso può fallire (navigazione privata, spazio esaurito): allora
 * si torna al comportamento di prima, mai un errore che blocca l'editor.
 */
const DB = "comic-builder";
const STORE = "session";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve((request.result as T | undefined) ?? null);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

const get = <T>(key: string) => run<T>("readonly", (s) => s.get(key));
const put = (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key));
const remove = (key: string) => run("readwrite", (s) => s.delete(key));

export const rememberFolder = (handle: DirectoryHandle) => put("folder", handle);

/**
 * Leggere un handle di cartella da IndexedDB, in alcune versioni di Chromium
 * (verificato: headless, con cartelle private OPFS), fa cadere la scheda. Si
 * segna l'inizio della lettura: se al caricamento successivo il segno è
 * ancora lì, la lettura precedente non è finita, e non la si ritenta — meglio
 * riaprire a mano che una scheda che cade a ogni avvio.
 */
export function markFolderRestore(active: boolean): void {
  try {
    if (active) localStorage.setItem("comic-builder:restoring-folder", "1");
    else localStorage.removeItem("comic-builder:restoring-folder");
  } catch {
    // Senza storage non c'è protezione, ma nemmeno riapertura da proteggere.
  }
}

export function folderRestoreCrashed(): boolean {
  try {
    return localStorage.getItem("comic-builder:restoring-folder") === "1";
  } catch {
    return false;
  }
}
export const rememberedFolder = () => get<DirectoryHandle>("folder");
export const forgetFolder = () => remove("folder");

export interface Recovery {
  doc: ProjectDoc;
  /** Le immagini caricate in memoria (arte, riferimenti), per percorso. */
  assets: Array<{ path: string; data: Uint8Array }>;
  at: string;
}

export const saveRecovery = (recovery: Recovery) => put("recovery", recovery);
export const loadRecovery = () => get<Recovery>("recovery");
export const clearRecovery = () => remove("recovery");

/**
 * Id della sessione, stabile fra un F5 e l'altro nella stessa scheda
 * (sessionStorage): il lock del progetto riconosce la propria scheda
 * ricaricata, invece di avvisare che il progetto «risulta aperto altrove».
 */
export function tabSession(): string {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));
  try {
    const existing = sessionStorage.getItem("comic-builder-session");
    if (existing) return existing;
    const id = make();
    sessionStorage.setItem("comic-builder-session", id);
    return id;
  } catch {
    return make();
  }
}

/** Preferenze dell'interfaccia in localStorage. Mai chiavi API: quelle digitate nella UI non si salvano. */
export function loadPreference<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`comic-builder:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function savePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(`comic-builder:${key}`, JSON.stringify(value));
  } catch {
    // Spazio esaurito o storage disabilitato: la preferenza non resta, niente di più.
  }
}
