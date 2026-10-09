import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Download } from "./catalog.js";

/**
 * Scarica un file e ne verifica lo SHA-256 contro quello del catalogo.
 *
 * I modelli pesano gigabyte: un download interrotto (rete, portatile chiuso,
 * «annulla») riprende da dove era arrivato, dal file `.part`, invece di
 * ricominciare. Il file finale compare solo quando il checksum torna: un
 * file a metà, o diverso da quello atteso, non viene mai usato.
 */
export interface Progress {
  received: number;
  total: number;
}

async function hashOf(file: string): Promise<{ hash: ReturnType<typeof createHash>; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { hash, bytes };
}

/** Vero se `file` c'è già, ed è quello giusto. */
export async function verified(file: string, sha256: string): Promise<boolean> {
  try {
    await fs.access(file);
  } catch {
    return false;
  }
  const { hash } = await hashOf(file);
  return hash.digest("hex") === sha256;
}

export async function download(item: Download, destination: string, options: { signal?: AbortSignal; onProgress?: (progress: Progress) => void } = {}): Promise<void> {
  if (await verified(destination, item.sha256)) {
    options.onProgress?.({ received: item.size, total: item.size });
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const part = `${destination}.part`;
  // Ciò che è già arrivato entra nel checksum prima di chiedere il resto.
  let { hash, bytes } = await hashOf(part);
  if (bytes > item.size) {
    await fs.rm(part, { force: true });
    ({ hash, bytes } = { hash: createHash("sha256"), bytes: 0 });
  }

  if (bytes < item.size) {
    const response = await fetch(item.url, { headers: bytes > 0 ? { range: `bytes=${bytes}-` } : {}, ...(options.signal ? { signal: options.signal } : {}) });
    // Un server che ignora la richiesta parziale rimanda tutto: si ricomincia da zero.
    if (bytes > 0 && response.status === 200) {
      await fs.rm(part, { force: true });
      ({ hash, bytes } = { hash: createHash("sha256"), bytes: 0 });
    } else if (!response.ok && response.status !== 206) {
      throw new Error(`Download non riuscito (HTTP ${response.status}): ${item.url}`);
    }
    if (!response.body) throw new Error(`Download senza contenuto: ${item.url}`);

    let received = bytes;
    let last = 0;
    const counter = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - last > 250) {
          last = now;
          options.onProgress?.({ received, total: item.size });
        }
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(part, { flags: bytes > 0 ? "a" : "w" }), ...(options.signal ? [{ signal: options.signal }] : []));
    options.onProgress?.({ received, total: item.size });
  }

  const digest = hash.digest("hex");
  if (digest !== item.sha256) {
    await fs.rm(part, { force: true });
    throw new Error(`Il file scaricato non è quello atteso (checksum diverso): ${path.basename(destination)}. Riprova.`);
  }
  await fs.rename(part, destination);
}
