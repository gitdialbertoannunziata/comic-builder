import { useEffect, useRef, useState } from "react";
import type { DirectoryHandle } from "./browserProjectStore.js";

/**
 * L'applicazione desktop (`packages/desktop`, Electron), vista dalla UI.
 *
 * La UI è la stessa del browser. Dove il browser ha un limite, il desktop
 * mette la sua versione dietro la stessa forma, così il resto del codice non
 * sa dove gira:
 *
 * - `showDirectoryPicker` apre il dialogo nativo e restituisce un handle
 *   compatibile con File System Access, scritto da Node: scritture atomiche
 *   (file d'appoggio e rename) e niente permesso da richiedere a ogni avvio;
 * - `desktopFetch` fa le chiamate dal processo principale: niente CORS,
 *   quindi niente proxy per FLUX, i modelli linguistici e il motore locale;
 * - le chiavi API si salvano cifrate nel portachiavi del sistema.
 *
 * Fuori dall'app `desktop` è null e tutto resta com'era.
 */
interface Stat {
  kind: "file" | "directory";
  size: number;
  lastModified: number;
}

interface DesktopBridge {
  platform: string;
  folders: { pick(title?: string): Promise<{ path: string; name: string } | null>; known(folder: string): Promise<boolean> };
  fs: {
    stat(target: string): Promise<Stat | null>;
    list(dir: string): Promise<Array<{ name: string; kind: "file" | "directory"; size?: number; lastModified?: number }>>;
    read(target: string): Promise<Uint8Array | null>;
    write(target: string, data: Uint8Array | string): Promise<void>;
    mkdir(target: string): Promise<void>;
    remove(target: string): Promise<void>;
  };
  net: {
    fetch(id: string, url: string, init: { method?: string; headers?: Array<[string, string]>; body?: string | Uint8Array }): Promise<{ status: number; statusText: string; headers: Array<[string, string]>; body: Uint8Array }>;
    abort(id: string): void;
  };
  secrets: { status(): Promise<{ available: boolean; backend: string }>; get(name: string): Promise<string | null>; set(name: string, value: string): Promise<boolean> };
  app: { onCloseRequested(callback: () => void): () => void; closeReady(): void };
}

export const desktop: DesktopBridge | null = (globalThis as { comicDesktop?: DesktopBridge }).comicDesktop ?? null;

// --- Cartelle ---

const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${desktop?.platform === "win32" ? "\\" : "/"}${name}`;
const notFound = (what: string) => new DOMException(`${what} non trovato`, "NotFoundError");

async function bytesOf(data: unknown): Promise<Uint8Array | string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("Dati da scrivere di un tipo non gestito");
}

/** Il «file» di File System Access, su un percorso vero. Scrivere bufferizza; chiudere scrive tutto in un colpo, atomicamente. */
class DesktopFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    readonly desktopPath: string,
  ) {}

  async getFile(): Promise<File> {
    const [stat, bytes] = await Promise.all([desktop!.fs.stat(this.desktopPath), desktop!.fs.read(this.desktopPath)]);
    if (!stat || !bytes) throw notFound(this.name);
    return new File([bytes as BlobPart], this.name, { lastModified: stat.lastModified });
  }

  async createWritable() {
    const parts: Array<Uint8Array | string> = [];
    const target = this.desktopPath;
    return {
      async write(data: unknown) {
        parts.push(await bytesOf(data));
      },
      async close() {
        const text = parts.every((p) => typeof p === "string");
        if (text) return desktop!.fs.write(target, (parts as string[]).join(""));
        const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p));
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const chunk of chunks) {
          all.set(chunk, at);
          at += chunk.length;
        }
        return desktop!.fs.write(target, all);
      },
      async abort() {
        parts.length = 0;
      },
    };
  }
}

/**
 * La cartella di File System Access, su un percorso vero. Solo metodi, niente
 * funzioni come proprietà: così si conserva in IndexedDB come quella del
 * browser (ne restano nome e percorso, e `rememberedDesktopFolder` la ricostruisce).
 */
export class DesktopDirectoryHandle {
  readonly kind = "directory" as const;
  constructor(
    readonly name: string,
    readonly desktopPath: string,
  ) {}

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<DesktopFileHandle> {
    const target = join(this.desktopPath, name);
    const stat = await desktop!.fs.stat(target);
    if (stat?.kind === "directory") throw new DOMException(`${name} è una cartella`, "TypeMismatchError");
    if (!stat && !options.create) throw notFound(name);
    return new DesktopFileHandle(name, target);
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<DesktopDirectoryHandle> {
    const target = join(this.desktopPath, name);
    const stat = await desktop!.fs.stat(target);
    if (stat?.kind === "file") throw new DOMException(`${name} è un file`, "TypeMismatchError");
    if (!stat) {
      if (!options.create) throw notFound(name);
      await desktop!.fs.mkdir(target);
    }
    return new DesktopDirectoryHandle(name, target);
  }

  async *values(): AsyncIterable<DesktopFileHandle | DesktopDirectoryHandle> {
    for (const entry of await desktop!.fs.list(this.desktopPath)) {
      const target = join(this.desktopPath, entry.name);
      yield entry.kind === "directory" ? new DesktopDirectoryHandle(entry.name, target) : new DesktopFileHandle(entry.name, target);
    }
  }

  async removeEntry(name: string): Promise<void> {
    const target = join(this.desktopPath, name);
    if (!(await desktop!.fs.stat(target))) throw notFound(name);
    await desktop!.fs.remove(target);
  }

  /** Una cartella scelta dal dialogo resta concessa: niente da chiedere. */
  queryPermission(): Promise<PermissionState> {
    return Promise.resolve("granted");
  }

  requestPermission(): Promise<PermissionState> {
    return Promise.resolve("granted");
  }
}

/** Dall'IndexedDB torna un oggetto semplice: se è una cartella del desktop ancora concessa e presente, la si ricostruisce. */
export async function rememberedDesktopFolder(value: unknown): Promise<DirectoryHandle | null> {
  if (!desktop || typeof value !== "object" || value === null || !("desktopPath" in value)) return null;
  const { desktopPath, name } = value as { desktopPath: string; name: string };
  if (!(await desktop.folders.known(desktopPath))) return null;
  const stat = await desktop.fs.stat(desktopPath).catch(() => null);
  return stat?.kind === "directory" ? (new DesktopDirectoryHandle(name, desktopPath) as unknown as DirectoryHandle) : null;
}

// --- Rete ---

let requests = 0;

/** `fetch` che passa dal processo principale: stessa forma, nessun CORS. */
export const desktopFetch: typeof fetch = async (input, init = {}) => {
  if (!desktop) throw new Error("desktopFetch fuori dall'app desktop");
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const id = `r${++requests}`;
  const headers = [...new Headers(init.headers ?? {}).entries()];
  let body: string | Uint8Array | undefined;
  if (typeof init.body === "string") body = init.body;
  else if (init.body instanceof Blob || init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) body = (await bytesOf(init.body)) as Uint8Array;
  else if (init.body != null) throw new TypeError("desktopFetch: corpo della richiesta di un tipo non gestito");
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw new DOMException("Richiesta annullata", "AbortError");
  const onAbort = () => desktop!.net.abort(id);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const call = desktop.net.fetch(id, url, { method: init.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) });
    const aborted = signal ? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Richiesta annullata", "AbortError")), { once: true })) : null;
    const result = await (aborted ? Promise.race([call, aborted]) : call);
    const empty = result.status === 204 || result.status === 304;
    return new Response(empty ? null : (result.body as BodyInit), { status: result.status, statusText: result.statusText, headers: result.headers });
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Richiesta annullata", "AbortError");
    // Come il fetch del browser: un errore di rete è un TypeError, e i servizi lo traducono.
    throw new TypeError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
};

/** La `fetch` da dare ai servizi: quella del desktop, o nessuna (vale quella del browser). */
export const networkFetch: { fetchImpl?: typeof fetch } = desktop ? { fetchImpl: desktopFetch } : {};

// --- Chiavi ---

let storage: Promise<{ available: boolean; backend: string }> | null = null;
const secureStorage = () => (storage ??= desktop ? desktop.secrets.status() : Promise.resolve({ available: false, backend: "browser" }));

/** Dove sta una chiave digitata qui, detto all'autore com'è davvero. */
export function useKeyNote(): string {
  const [note, setNote] = useState(desktop ? "" : "Resta in questa scheda e non viene salvata. ");
  useEffect(() => {
    if (!desktop) return;
    void secureStorage().then((s) =>
      setNote(s.available ? "Salvata cifrata nel portachiavi del sistema. " : "Su questo sistema non c'è un portachiavi: resta in memoria finché l'app è aperta. "),
    );
  }, []);
  return note;
}

/**
 * Una chiave API: nel browser vive nella scheda; nell'app desktop si
 * ritrova al prossimo avvio, cifrata. Quella letta da `.env.local` (solo in
 * sviluppo) vince, ed è già lì.
 */
export function useSecret(name: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState(initial);
  const touched = useRef(false);
  useEffect(() => {
    if (!desktop || initial) return;
    void secureStorage().then(async (s) => {
      if (!s.available) return;
      const stored = await desktop!.secrets.get(name);
      if (stored && !touched.current) setValue(stored);
    });
  }, [name, initial]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (next: string) => {
    touched.current = true;
    setValue(next);
    if (!desktop) return;
    if (timer.current) clearTimeout(timer.current);
    // Una scrittura quando si smette di digitare, non una per tasto.
    timer.current = setTimeout(() => void secureStorage().then((s) => s.available && desktop!.secrets.set(name, next.trim())), 400);
  };
  return [value, set];
}

/** Al caricamento della UI (questo modulo si importa per primo): il selettore di cartelle del browser lascia il posto a quello nativo. */
function installDesktopFolders(): void {
  if (!desktop) return;
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => {
    const folder = await desktop!.folders.pick();
    // Come il browser quando si annulla il dialogo.
    if (!folder) throw new DOMException("Scelta annullata", "AbortError");
    return new DesktopDirectoryHandle(folder.name, folder.path);
  };
}

installDesktopFolders();
