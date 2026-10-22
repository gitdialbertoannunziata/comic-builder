import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { isProjectPath, type ProjectStore, type StoreEntry } from "@comic-builder/core";
import { within } from "./roots.js";

/** Il suffisso dei file d'appoggio: lo stesso dell'app desktop, che li salta quando elenca. */
const TEMP_MARK = ".comic-tmp-";

function notFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * La cartella di un progetto su disco, con `fs` di Node: lo stesso contratto
 * di `ProjectStore` che nell'app implementa l'IPC di Electron. Ogni percorso
 * è relativo alla radice del progetto, e prima di toccare il disco passa da
 * due controlli: la forma (`isProjectPath`, niente `..` né assoluti) e la
 * posizione vera, link simbolici risolti, dentro la cartella del progetto.
 */
export class NodeProjectStore implements ProjectStore {
  readonly label: string;

  constructor(readonly root: string) {
    this.label = path.basename(root);
  }

  private async resolve(relative: string): Promise<string> {
    if (!isProjectPath(relative)) throw new Error(`Invalid project path: ${relative}`);
    return within(path.join(this.root, ...relative.split("/")), [this.root]);
  }

  async readText(relative: string): Promise<string | null> {
    const bytes = await this.readBytes(relative);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  async readBytes(relative: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(await this.resolve(relative)));
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  }

  writeText(relative: string, text: string): Promise<void> {
    return this.write(relative, text);
  }

  writeBytes(relative: string, data: Uint8Array): Promise<void> {
    return this.write(relative, data);
  }

  /** Scrittura atomica (§11.3): file d'appoggio accanto, poi rename. O il file nuovo intero, o quello vecchio intatto. */
  private async write(relative: string, data: Uint8Array | string): Promise<void> {
    const file = await this.resolve(relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}${TEMP_MARK}${randomBytes(4).toString("hex")}`;
    try {
      await fs.writeFile(temp, data);
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  async list(directory: string): Promise<StoreEntry[]> {
    const dir = directory === "" ? await within(this.root, [this.root]) : await this.resolve(directory.replace(/\/$/, ""));
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (notFound(error)) return [];
      throw error;
    }
    const out: StoreEntry[] = [];
    for (const entry of entries) {
      if (entry.name.includes(TEMP_MARK)) continue;
      if (entry.isDirectory()) out.push({ name: entry.name, kind: "directory" });
      else if (entry.isFile()) {
        const stat = await fs.stat(path.join(dir, entry.name));
        out.push({ name: entry.name, kind: "file", size: stat.size, lastModified: stat.mtimeMs });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async remove(relative: string): Promise<void> {
    await fs.rm(await this.resolve(relative), { force: true });
  }
}
