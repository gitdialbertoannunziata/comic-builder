import type { ProjectStore } from "./store.js";

/**
 * Lock file del progetto (§11.3). Due finestre aperte sulla stessa cartella
 * si sovrascrivono a vicenda in silenzio, ognuna col suo autosave: il lock
 * non lo impedisce fisicamente — non esiste un lock vero su una cartella
 * sincronizzata o su File System Access — ma fa sì che la seconda apertura
 * lo *sappia* e lo dica.
 *
 * Il lock scade se non viene rinnovato: una sessione morta (crash, tab
 * chiusa di colpo) non deve bloccare il progetto per sempre.
 */
export const LOCK_FILE = ".comic-lock";
export const LOCK_TTL_MS = 2 * 60 * 1000;

export interface LockInfo {
  session: string;
  /** Chi la tiene, in forma leggibile (browser, host). */
  holder: string;
  at: string;
}

export type LockResult = { acquired: true } | { acquired: false; held: LockInfo };

async function readLock(store: ProjectStore): Promise<LockInfo | null> {
  const text = await store.readText(LOCK_FILE);
  if (text === null) return null;
  try {
    return JSON.parse(text) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Prende il lock se è libero, scaduto o già nostro. Con `force` lo prende
 * comunque: è la scelta esplicita dell'utente dopo l'avviso ("apri lo stesso").
 */
export async function acquireLock(
  store: ProjectStore,
  session: string,
  holder: string,
  now: Date,
  options: { force?: boolean } = {},
): Promise<LockResult> {
  const current = await readLock(store);
  if (current && current.session !== session && !options.force) {
    const age = now.getTime() - Date.parse(current.at);
    if (Number.isFinite(age) && age < LOCK_TTL_MS) return { acquired: false, held: current };
  }
  await store.writeText(LOCK_FILE, `${JSON.stringify({ session, holder, at: now.toISOString() })}\n`);
  return { acquired: true };
}

/** Rinnovo periodico: tiene vivo il lock finché la sessione è aperta. */
export function refreshLock(store: ProjectStore, session: string, holder: string, now: Date): Promise<LockResult> {
  return acquireLock(store, session, holder, now);
}

/** Rilascia solo un lock nostro: mai quello di un'altra sessione. */
export async function releaseLock(store: ProjectStore, session: string): Promise<void> {
  const current = await readLock(store);
  if (current?.session === session) await store.remove(LOCK_FILE);
}
