import type { ExportFile, PlatformService, WriteOutcome } from "@comic-builder/core";

/**
 * Tipi dell'API di accesso al filesystem. Non sono nelle librerie standard di
 * TypeScript perché l'API non è supportata ovunque — ed è esattamente il
 * motivo per cui esiste anche il ripiego sul download.
 */
interface FileSystemWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  createWritable(): Promise<FileSystemWritable>;
}
interface DirectoryHandle {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
}
type DirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
  const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(globalThis) : null;
}

function blobFor(file: ExportFile): Blob {
  return new Blob([file.data as BlobPart], { type: file.mediaType });
}

/**
 * `PlatformService` per il browser (§11.1).
 *
 * Due modi di scrivere, e la differenza va detta all'utente invece che
 * nascosta: dove il browser espone l'accesso al filesystem si sceglie davvero
 * una cartella e i file ci finiscono dentro; dove non c'è, restano i download,
 * e allora **la destinazione la decide il browser** — promettere un percorso
 * che non controlliamo sarebbe una bugia.
 */
export class BrowserPlatformService implements PlatformService {
  readonly name = "browser";
  private handle: DirectoryHandle | null = null;

  get canChooseDestination(): boolean {
    return directoryPicker() !== null;
  }

  async chooseDestination(): Promise<string | null> {
    const picker = directoryPicker();
    if (!picker) return null;

    try {
      this.handle = await picker({ mode: "readwrite" });
      return this.handle.name;
    } catch {
      // L'utente ha annullato il dialogo: non è un errore da mostrare.
      return null;
    }
  }

  get destination(): string | null {
    return this.handle?.name ?? null;
  }

  async write(files: readonly ExportFile[]): Promise<WriteOutcome> {
    if (this.handle) {
      for (const file of files) {
        const fileHandle = await this.handle.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blobFor(file));
        await writable.close();
      }
      return { written: files.length, destination: this.handle.name };
    }

    for (const file of files) {
      const url = URL.createObjectURL(blobFor(file));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      // Revoca ritardata: revocare subito può interrompere il download appena
      // avviato, e il file arriva troncato o non arriva affatto.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }

    return { written: files.length, destination: "cartella dei download del browser" };
  }
}
