import type { ProjectStore, StoreEntry } from "@comic-builder/core";

/**
 * `ProjectStore` sopra la File System Access API (Chrome, Edge).
 *
 * Atomicità: `createWritable()` scrive su un file d'appoggio che sostituisce
 * l'originale solo alla `close()` — è la specifica dell'API, non una nostra
 * premessa. Un crash a metà scrittura lascia il file com'era, che è la
 * garanzia che il Core chiede allo store (§11.3). Per i salvataggi che
 * toccano più file ci pensa il journal del Core.
 */
interface Writable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<Writable>;
}
export interface DirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

type DirectoryPicker = (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<DirectoryHandle>;

export function canOpenFolders(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** Chiede una cartella; null se l'utente annulla. */
export async function pickFolder(): Promise<DirectoryHandle | null> {
  const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    return await picker.call(globalThis, { mode: "readwrite", id: "comic-builder-project" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError");
}

export class BrowserProjectStore implements ProjectStore {
  constructor(private readonly root: DirectoryHandle) {}

  get label(): string {
    return this.root.name;
  }

  private async directory(parts: string[], create: boolean): Promise<DirectoryHandle | null> {
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (error) {
        if (!create && isNotFound(error)) return null;
        throw error;
      }
    }
    return dir;
  }

  private split(path: string): { dirs: string[]; name: string } {
    const parts = path.split("/").filter((p) => p.length > 0);
    const name = parts.pop();
    if (!name) throw new Error(`Percorso vuoto: "${path}"`);
    return { dirs: parts, name };
  }

  private async file(path: string): Promise<File | null> {
    const { dirs, name } = this.split(path);
    const dir = await this.directory(dirs, false);
    if (!dir) return null;
    try {
      return await (await dir.getFileHandle(name)).getFile();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readText(path: string): Promise<string | null> {
    const file = await this.file(path);
    return file ? file.text() : null;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const file = await this.file(path);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  }

  private async write(path: string, data: string | Uint8Array): Promise<void> {
    const { dirs, name } = this.split(path);
    const dir = await this.directory(dirs, true);
    const handle = await dir!.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data as BufferSource | string);
      await writable.close();
    } catch (error) {
      // Senza close() il file d'appoggio si scarta e l'originale resta intatto.
      await writable.abort?.();
      throw error;
    }
  }

  writeText(path: string, text: string): Promise<void> {
    return this.write(path, text);
  }

  writeBytes(path: string, data: Uint8Array): Promise<void> {
    return this.write(path, data);
  }

  async list(directory: string): Promise<StoreEntry[]> {
    const dir = await this.directory(directory.split("/").filter((p) => p.length > 0), false);
    if (!dir) return [];
    const entries: StoreEntry[] = [];
    for await (const handle of dir.values()) {
      if (handle.kind === "directory") {
        entries.push({ name: handle.name, kind: "directory" });
      } else {
        const file = await handle.getFile();
        entries.push({ name: handle.name, kind: "file", lastModified: file.lastModified, size: file.size });
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = this.split(path);
    const dir = await this.directory(dirs, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
