import { fromUtf8, utf8 } from "../util/utf8.js";

/**
 * Accesso alla cartella di progetto (§5.1), visto dal Core.
 *
 * Il Core non tocca il filesystem (§11.2): dichiara cosa gli serve, e
 * l'host lo implementa — File System Access nel browser, `fs` in Node, i
 * comandi di Tauri o Electron domani. I percorsi sono relativi alla radice
 * del progetto e usano sempre "/".
 */
export interface StoreEntry {
  name: string;
  kind: "file" | "directory";
  /** Millisecondi epoch; serve a sorvegliare la cartella dell'arte senza leggerla tutta. */
  lastModified?: number;
  size?: number;
}

export interface ProjectStore {
  /** Etichetta leggibile della cartella, per la UI. */
  readonly label: string;
  /** Il contenuto, o null se il file non esiste. */
  readText(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
  /**
   * Scrittura **atomica**: o il file nuovo intero, o quello vecchio intatto.
   * Mai un file a metà (§11.3). Crea le cartelle intermedie.
   */
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  /** Voci di una cartella; vuoto se la cartella non esiste. */
  list(directory: string): Promise<StoreEntry[]>;
  /** Rimuove un file; nessun errore se non esiste. */
  remove(path: string): Promise<void>;
}

/**
 * Store in memoria: per i test, e per lavorare senza una cartella (la demo
 * nel browser prima di aprire un progetto). Atomico per costruzione.
 */
export class MemoryProjectStore implements ProjectStore {
  readonly label: string;
  private readonly files = new Map<string, { data: Uint8Array | string; lastModified: number }>();
  private clock = 0;
  /** Ultimo tempo usato: i test lo fanno avanzare per simulare modifiche esterne. */
  now: () => number = () => ++this.clock;
  /** Registro delle scritture, in ordine: serve ai test per verificare *cosa* si è salvato. */
  readonly writes: string[] = [];

  constructor(label = "memoria", initial: Record<string, string | Uint8Array> = {}) {
    this.label = label;
    for (const [path, data] of Object.entries(initial)) this.files.set(path, { data, lastModified: this.now() });
  }

  readText(path: string): Promise<string | null> {
    const file = this.files.get(path);
    if (!file) return Promise.resolve(null);
    return Promise.resolve(typeof file.data === "string" ? file.data : fromUtf8(file.data));
  }

  readBytes(path: string): Promise<Uint8Array | null> {
    const file = this.files.get(path);
    if (!file) return Promise.resolve(null);
    return Promise.resolve(typeof file.data === "string" ? utf8(file.data) : file.data);
  }

  writeText(path: string, text: string): Promise<void> {
    this.files.set(path, { data: text, lastModified: this.now() });
    this.writes.push(path);
    return Promise.resolve();
  }

  writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, { data, lastModified: this.now() });
    this.writes.push(path);
    return Promise.resolve();
  }

  list(directory: string): Promise<StoreEntry[]> {
    const prefix = directory === "" ? "" : `${directory.replace(/\/$/, "")}/`;
    const entries = new Map<string, StoreEntry>();
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [head, ...tail] = rest.split("/");
      if (!head) continue;
      if (tail.length > 0) entries.set(head, { name: head, kind: "directory" });
      else {
        const size = typeof file.data === "string" ? utf8(file.data).length : file.data.length;
        entries.set(head, { name: head, kind: "file", lastModified: file.lastModified, size });
      }
    }
    return Promise.resolve([...entries.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  /** Tutti i percorsi presenti: per i test. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}
