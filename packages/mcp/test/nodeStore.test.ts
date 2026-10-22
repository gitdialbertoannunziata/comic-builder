import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeProjectStore } from "../src/nodeStore.js";
import { parseRoots } from "../src/roots.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "comic-mcp-store-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("NodeProjectStore", () => {
  it("scrive, rilegge, elenca e rimuove", async () => {
    const store = new NodeProjectStore(dir);
    await store.writeText("pages/p1.json", "{}\n");
    await store.writeBytes("art/a.png", new Uint8Array([1, 2, 3]));
    expect(await store.readText("pages/p1.json")).toBe("{}\n");
    expect(await store.readBytes("art/a.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect((await store.list("")).map((e) => `${e.kind}:${e.name}`)).toEqual(["directory:art", "directory:pages"]);
    const [file] = await store.list("art");
    expect(file).toMatchObject({ name: "a.png", kind: "file", size: 3 });
    await store.remove("art/a.png");
    expect(await store.readBytes("art/a.png")).toBeNull();
  });

  it("restituisce null o vuoto per ciò che non esiste", async () => {
    const store = new NodeProjectStore(dir);
    expect(await store.readText("missing.json")).toBeNull();
    expect(await store.list("nowhere")).toEqual([]);
    await expect(store.remove("missing.json")).resolves.toBeUndefined();
  });

  it("non lascia file d'appoggio dopo una scrittura", async () => {
    const store = new NodeProjectStore(dir);
    await store.writeText("project.json", "a");
    await store.writeText("project.json", "b");
    expect(await fs.readdir(dir)).toEqual(["project.json"]);
  });

  it("rifiuta percorsi che escono dal progetto", async () => {
    const store = new NodeProjectStore(dir);
    for (const bad of ["../x.json", "/etc/passwd", "C:/x", "a/../../x", "a\\b", "./x"]) {
      await expect(store.readText(bad)).rejects.toThrow();
      await expect(store.writeText(bad, "x")).rejects.toThrow();
    }
  });

  it("rifiuta un link simbolico che punta fuori", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "comic-mcp-outside-"));
    try {
      await fs.writeFile(path.join(outside, "secret.txt"), "no");
      try {
        await fs.symlink(outside, path.join(dir, "link"), "junction");
      } catch {
        return; // Niente permessi per creare link su questa macchina: il controllo non si può esercitare.
      }
      const store = new NodeProjectStore(dir);
      await expect(store.readText("link/secret.txt")).rejects.toThrow(/outside/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("parseRoots", () => {
  it("legge --root, --root= e COMIC_BUILDER_ROOTS", () => {
    const roots = parseRoots(["--root", "a", "--root=b"], { COMIC_BUILDER_ROOTS: ["c", "d"].join(path.delimiter) });
    expect(roots).toEqual(["a", "b", "c", "d"].map((r) => path.resolve(r)));
  });

  it("si lamenta di --root senza cartella", () => {
    expect(() => parseRoots(["--root"], {})).toThrow();
  });
});
