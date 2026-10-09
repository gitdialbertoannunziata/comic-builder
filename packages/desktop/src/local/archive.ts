import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Estrae gli archivi dei motori: zip (Windows, stable-diffusion.cpp) e
 * tar.gz (llama.cpp su macOS e Linux). Scritto qui invece di dipendere da
 * `unzip` o `tar` del sistema, che non ci sono ovunque (un Linux minimale
 * non ha `unzip`), e da una libreria, che l'app impacchettata dovrebbe
 * portarsi dietro. Gli archivi sono di poche decine di MB: si leggono in
 * memoria.
 *
 * Conserva ciò che serve a far partire un binario: i permessi di
 * esecuzione e i link simbolici delle librerie (`libllama.so` →
 * `libllama.so.0`). Rifiuta i percorsi che escono dalla cartella.
 */

interface Entry {
  name: string;
  kind: "file" | "directory" | "symlink";
  mode: number;
  data: Buffer;
  /** Per i link simbolici. */
  target?: string;
}

function safeJoin(root: string, name: string): string {
  const clean = name.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!clean || clean.startsWith("/") || /^[a-zA-Z]:/.test(clean) || clean.split("/").includes("..")) throw new Error(`Percorso non ammesso nell'archivio: ${name}`);
  return path.join(root, clean);
}

// --- zip ---

function zipEntries(buffer: Buffer): Entry[] {
  // La fine della directory centrale: si cerca a ritroso, dopo un eventuale commento.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("Archivio zip non valido: manca la directory centrale.");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error("Archivio zip non valido: voce della directory centrale rovinata.");
    const madeBy = buffer.readUInt16LE(at + 4) >> 8;
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const external = buffer.readUInt32LE(at + 38);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    // Fatto su Unix: i permessi stanno nei 16 bit alti degli attributi esterni.
    const unixMode = madeBy === 3 ? external >>> 16 : 0;
    const type = unixMode & 0o170000;
    // Una cartella non ha contenuto da decomprimere, anche se si dichiara compressa.
    if (name.endsWith("/") || type === 0o040000) {
      entries.push({ name, kind: "directory", mode: 0o755, data: Buffer.alloc(0) });
      continue;
    }
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    if (method !== 0 && method !== 8) throw new Error(`Archivio zip con una compressione non gestita (${method}): ${name}`);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (type === 0o120000) entries.push({ name, kind: "symlink", mode: 0o777, data: Buffer.alloc(0), target: data.toString("utf8") });
    else entries.push({ name, kind: "file", mode: unixMode & 0o777 || 0o644, data });
  }
  return entries;
}

// --- tar.gz ---

const field = (block: Buffer, offset: number, length: number) => {
  const raw = block.subarray(offset, offset + length);
  const zero = raw.indexOf(0);
  return raw.toString("utf8", 0, zero < 0 ? length : zero);
};
const octal = (block: Buffer, offset: number, length: number) => parseInt(field(block, offset, length).trim() || "0", 8);

function tarEntries(buffer: Buffer): Entry[] {
  const tar = gunzipSync(buffer);
  const entries: Entry[] = [];
  let at = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const data = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = field(data, 0, data.length);
      continue;
    }
    if (type === "K") {
      longLink = field(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      // Intestazione PAX: righe «<lunghezza> chiave=valore\n».
      pax = {};
      for (const line of data.toString("utf8").split("\n")) {
        const match = /^\d+ ([^=]+)=(.*)$/.exec(line);
        if (match) pax[match[1]!] = match[2]!;
      }
      continue;
    }
    if (type === "g") continue;

    const prefix = field(header, 345, 155);
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    const target = pax.linkpath ?? longLink ?? field(header, 157, 100);
    longName = longLink = null;
    pax = {};
    const mode = octal(header, 100, 8) & 0o777;
    if (type === "5") entries.push({ name, kind: "directory", mode: mode || 0o755, data: Buffer.alloc(0) });
    else if (type === "2") entries.push({ name, kind: "symlink", mode: 0o777, data: Buffer.alloc(0), target });
    // Un link fisico diventa una copia del file a cui punta, già estratto.
    else if (type === "1") {
      const original = entries.find((e) => e.name === target && e.kind === "file");
      if (original) entries.push({ name, kind: "file", mode: original.mode, data: original.data });
    } else if (type === "0" || type === "\0" || type === "7") entries.push({ name, kind: "file", mode: mode || 0o644, data: Buffer.from(data) });
  }
  return entries;
}

/** Estrae `archive` in `destination` e restituisce i percorsi dei file estratti. */
export async function extract(archive: string, destination: string): Promise<string[]> {
  const buffer = await fs.readFile(archive);
  const entries = archive.endsWith(".zip") ? zipEntries(buffer) : tarEntries(buffer);
  const written: string[] = [];
  await fs.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const target = safeJoin(destination, entry.name);
    if (entry.kind === "directory") {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (entry.kind === "symlink") {
      // Solo link che restano dentro la cartella: è il caso delle librerie versionate.
      safeJoin(path.dirname(target), entry.target ?? "");
      await fs.rm(target, { force: true });
      if (process.platform === "win32") continue;
      await fs.symlink(entry.target!, target);
    } else {
      await fs.writeFile(target, entry.data, { mode: entry.mode });
      written.push(target);
    }
  }
  return written;
}

/** Il binario estratto, ovunque stia nella cartella (gli archivi lo mettono a livelli diversi). */
export async function findBinary(root: string, name: string): Promise<string | null> {
  const wanted = process.platform === "win32" ? `${name}.exe` : name;
  for (const entry of await fs.readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === wanted) return path.join(entry.parentPath, entry.name);
  }
  return null;
}
