import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { extract, findBinary } from "../src/local/archive.js";

/** Uno zip minimo come quelli di stable-diffusion.cpp: voci compresse, permessi Unix, un link simbolico. */
function zip(entries: Array<{ name: string; data?: string; mode?: number; symlink?: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.symlink ?? entry.data ?? "");
    const directory = entry.name.endsWith("/");
    const data = directory ? Buffer.alloc(0) : deflateRawSync(raw);
    const mode = entry.symlink ? 0o120777 : directory ? 0o040755 : 0o100000 | (entry.mode ?? 0o644);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const temp = () => mkdtempSync(path.join(tmpdir(), "archivio-"));

describe("Estrazione degli archivi dei motori", () => {
  it("zip: file, cartelle, permesso di esecuzione del binario, link simbolico di una libreria", async () => {
    const dir = temp();
    await fs.writeFile(path.join(dir, "motore.zip"), zip([{ name: "bin/" }, { name: "bin/sd-server", data: "#!/bin/sh\necho ok\n", mode: 0o755 }, { name: "bin/libggml.so.0", data: "lib" }, { name: "bin/libggml.so", symlink: "libggml.so.0" }]));
    await extract(path.join(dir, "motore.zip"), path.join(dir, "out"));
    const binary = await findBinary(path.join(dir, "out"), "sd-server");
    expect(binary).toBe(path.join(dir, "out", "bin", "sd-server"));
    expect((await fs.stat(binary!)).mode & 0o111).not.toBe(0);
    expect(execFileSync(binary!).toString()).toBe("ok\n");
    expect(await fs.readlink(path.join(dir, "out", "bin", "libggml.so"))).toBe("libggml.so.0");
  });

  it("tar.gz: come gli archivi di llama.cpp, cartella dentro, binario eseguibile, link alle librerie", async () => {
    const dir = temp();
    const src = path.join(dir, "llama-b1");
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, "llama-server"), "#!/bin/sh\necho server\n", { mode: 0o755 });
    await fs.writeFile(path.join(src, "libllama.so.0.6.0"), "lib");
    await fs.symlink("libllama.so.0.6.0", path.join(src, "libllama.so"));
    await fs.writeFile(path.join(src, `${"nome-molto-lungo-".repeat(8)}.txt`), "lungo");
    execFileSync("tar", ["-czf", path.join(dir, "motore.tar.gz"), "-C", dir, "llama-b1"]);
    await extract(path.join(dir, "motore.tar.gz"), path.join(dir, "out"));
    const binary = await findBinary(path.join(dir, "out"), "llama-server");
    expect(execFileSync(binary!).toString()).toBe("server\n");
    expect(await fs.readlink(path.join(dir, "out", "llama-b1", "libllama.so"))).toBe("libllama.so.0.6.0");
    expect(await fs.readFile(path.join(dir, "out", "llama-b1", `${"nome-molto-lungo-".repeat(8)}.txt`), "utf8")).toBe("lungo");
  });

  it("un percorso che esce dalla cartella, o un link che punta fuori, si rifiuta", async () => {
    const dir = temp();
    await fs.writeFile(path.join(dir, "cattivo.zip"), zip([{ name: "../fuori.txt", data: "x" }]));
    await expect(extract(path.join(dir, "cattivo.zip"), path.join(dir, "out"))).rejects.toThrow(/non ammesso/);
    await fs.writeFile(path.join(dir, "link.zip"), zip([{ name: "libx.so", symlink: "../../etc/passwd" }]));
    await expect(extract(path.join(dir, "link.zip"), path.join(dir, "out2"))).rejects.toThrow(/non ammesso/);
    await expect(fs.access(path.join(dir, "fuori.txt"))).rejects.toThrow();
  });
});
