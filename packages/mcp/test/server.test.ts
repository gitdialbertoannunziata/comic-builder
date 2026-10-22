import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LOCK_FILE, loadProject } from "@comic-builder/core";
import { sampleScene } from "@comic-builder/core/fixtures";
import { NodeProjectStore } from "../src/nodeStore.js";
import { createServer } from "../src/server.js";

let root: string;
let client: Client;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "comic-mcp-"));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer([root]).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error(`Expected text, got ${first?.type}`);
  return first.text;
}

async function ok<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${text(result)}`);
  return JSON.parse(text(result)) as T;
}

const scene = { ...sampleScene, id: "ep001-s1" };

describe("server MCP", () => {
  it("dal progetto vuoto al CBZ", async () => {
    const created = await ok<{ path: string; chapters: { id: string }[] }>("create_project", { folder: "storia", title: "Storia di prova" });
    expect(created.chapters.map((c) => c.id)).toEqual(["ep001"]);
    expect(await ok<{ title: string }[]>("list_projects")).toEqual([expect.objectContaining({ title: "Storia di prova" })]);

    await ok("set_script", { chapterId: "ep001", text: "# Scena 1\nUn copione." });
    const laid = await ok<{ pages: { id: string }[] }>("layout_chapter", { chapterId: "ep001", scenes: [scene] });
    expect(laid.pages.length).toBeGreaterThan(0);

    const chapter = await ok<{ pages: { id: string }[]; scenes: { id: string }[] }>("get_chapter", { chapterId: "ep001" });
    expect(chapter.pages.map((p) => p.id)).toEqual(laid.pages.map((p) => p.id));
    expect(chapter.scenes.map((s) => s.id)).toEqual(["ep001-s1"]);
    expect(text(await call("get_script", { chapterId: "ep001" }))).toContain("Un copione.");

    await ok("apply_commands", { commands: [{ type: "character.upsert", ref: "mara", patch: { name: "Mara" } }, { type: "project.rename", title: "Titolo nuovo" }] });
    const project = await ok<{ title: string; characters: { ref: string }[] }>("get_project");
    expect(project.title).toBe("Titolo nuovo");
    expect(project.characters.map((c) => c.ref)).toContain("mara");

    await ok("validate", { chapterId: "ep001" });

    const preview = await call("preview_page", { pageId: laid.pages[0]!.id, widthPx: 300 });
    expect(preview.isError).toBeFalsy();
    const image = preview.content[0];
    expect(image?.type).toBe("image");
    if (image?.type === "image") expect(Buffer.from(image.data, "base64").subarray(1, 4).toString()).toBe("PNG");

    const targets = (await ok<{ targets: { id: string; kind: string }[] }>("get_project")).targets;
    const archive = targets.find((t) => t.kind === "archive");
    const exported = await ok<{ written: string[] }>("export_chapter", { chapterId: "ep001", targets: archive ? [archive.id] : [] });
    expect(exported.written.length).toBeGreaterThan(0);
    for (const file of exported.written) expect((await fs.stat(file)).size).toBeGreaterThan(0);

    // Ciò che il server ha scritto si riapre come un progetto valido, senza lock lasciati in giro.
    const store = new NodeProjectStore(created.path);
    const { doc } = await loadProject(store);
    expect(doc.project.title).toBe("Titolo nuovo");
    expect(await store.readText(LOCK_FILE)).toBeNull();
  });

  it("un comando non valido non scrive nulla", async () => {
    const { path: dir } = await ok<{ path: string }>("create_project", { folder: "p", title: "P" });
    const before = await fs.readFile(path.join(dir, "project.json"), "utf8");
    const result = await call("apply_commands", {
      commands: [
        { type: "project.rename", title: "Cambiato" },
        { type: "page.remove", pageId: "non-esiste" },
      ],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Command 1 \(page\.remove\)/);
    expect(await fs.readFile(path.join(dir, "project.json"), "utf8")).toBe(before);
  });

  it("non scrive se il progetto è aperto nell'app", async () => {
    const { path: dir } = await ok<{ path: string }>("create_project", { folder: "aperto", title: "Aperto" });
    await fs.writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ session: "app", holder: "comic-builder desktop", at: new Date().toISOString() }));
    const result = await call("apply_commands", { commands: [{ type: "project.rename", title: "No" }] });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/open elsewhere/);
    // Le letture restano possibili.
    expect((await ok<{ title: string }>("get_project")).title).toBe("Aperto");
  });

  it("non esce dalle radici", async () => {
    const result = await call("open_project", { project: path.resolve(root, "..") });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/outside/);
  });
});
