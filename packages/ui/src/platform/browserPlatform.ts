import { createZip, utf8, type ExportFile, type PlatformService, type WriteOutcome } from "@comic-builder/core";

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
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
}
type DirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;

function directoryPicker(): DirectoryPicker | null {
  const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(globalThis) : null;
}

/**
 * Un nome con cartelle (`print-b5/001-p1.png`) diventa una cartella vera: un
 * export in più formati resta ordinato per formato invece di mescolarsi.
 */
async function fileHandleFor(root: DirectoryHandle, path: string): Promise<FileHandle> {
  const parts = path.split("/").filter((p) => p.length > 0);
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Nome di file vuoto: "${path}"`);
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory.getFileHandle(fileName, { create: true });
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
        const fileHandle = await fileHandleFor(this.handle, file.name);
        const writable = await fileHandle.createWritable();
        await writable.write(blobFor(file));
        await writable.close();
      }
      return { written: files.length, destination: this.handle.name };
    }

    // Più di un file va in un archivio solo. Non per comodità: i browser
    // bloccano o scartano in silenzio le raffiche di download automatici —
    // verificato in Chromium, 10 file arrivati su 19 in un export a cinque
    // formati. Un file perso senza avviso in una consegna è il danno peggiore.
    if (files.length === 1) {
      const file = files[0]!;
      // Un download non può creare cartelle: la "/" diventa un trattino.
      download(blobFor(file), file.name.replace(/\//g, "-"));
      return { written: 1, destination: "cartella dei download del browser" };
    }

    const archive = createZip(
      files.map((file) => ({ name: file.name, data: typeof file.data === "string" ? utf8(file.data) : file.data })),
      new Date(),
    );
    const name = `comic-builder-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
    download(new Blob([archive as BlobPart], { type: "application/zip" }), name);
    return { written: files.length, destination: `${name}, nei download del browser` };
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoca ritardata: revocare subito può interrompere il download appena
  // avviato, e il file arriva troncato o non arriva affatto.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
