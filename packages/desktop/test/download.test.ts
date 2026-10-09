import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, promises as fs } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { download, verified } from "../src/local/download.js";

const content = randomBytes(300_000);
const sha256 = createHash("sha256").update(content).digest("hex");
const requests: Array<string | undefined> = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  // Un server che rispetta le richieste parziali, come GitHub e Hugging Face.
  server = http.createServer((req, res) => {
    requests.push(req.headers.range);
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (req.url === "/file" && range) {
      const start = Number(range[1]);
      res.writeHead(206, { "content-length": content.length - start });
      res.end(content.subarray(start));
    } else if (req.url === "/file") {
      res.writeHead(200, { "content-length": content.length });
      res.end(content);
    } else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const temp = () => mkdtempSync(path.join(tmpdir(), "download-"));

describe("Download dei modelli", () => {
  it("scarica, verifica il checksum, e il file compare solo alla fine", async () => {
    const dir = temp();
    const seen: number[] = [];
    await download({ url: `${base}/file`, sha256, size: content.length }, path.join(dir, "m.gguf"), { onProgress: (p) => seen.push(p.received) });
    expect(Buffer.compare(await fs.readFile(path.join(dir, "m.gguf")), content)).toBe(0);
    expect(seen.at(-1)).toBe(content.length);
    await expect(fs.access(path.join(dir, "m.gguf.part"))).rejects.toThrow();
  });

  it("un download interrotto riprende da dove era arrivato", async () => {
    const dir = temp();
    await fs.writeFile(path.join(dir, "m.gguf.part"), content.subarray(0, 120_000));
    requests.length = 0;
    await download({ url: `${base}/file`, sha256, size: content.length }, path.join(dir, "m.gguf"));
    expect(requests).toEqual(["bytes=120000-"]);
    expect(await verified(path.join(dir, "m.gguf"), sha256)).toBe(true);
  });

  it("un file già scaricato e giusto non si riscarica", async () => {
    const dir = temp();
    await fs.writeFile(path.join(dir, "m.gguf"), content);
    requests.length = 0;
    await download({ url: `${base}/file`, sha256, size: content.length }, path.join(dir, "m.gguf"));
    expect(requests).toEqual([]);
  });

  it("un checksum diverso scarta il file: niente di sbagliato resta sul disco", async () => {
    const dir = temp();
    await expect(download({ url: `${base}/file`, sha256: "0".repeat(64), size: content.length }, path.join(dir, "m.gguf"))).rejects.toThrow(/checksum diverso/);
    await expect(fs.access(path.join(dir, "m.gguf"))).rejects.toThrow();
    await expect(fs.access(path.join(dir, "m.gguf.part"))).rejects.toThrow();
  });

  it("annullare ferma il download e lascia la parte già arrivata per riprendere", async () => {
    const dir = temp();
    const controller = new AbortController();
    controller.abort();
    await expect(download({ url: `${base}/file`, sha256, size: content.length }, path.join(dir, "m.gguf"), { signal: controller.signal })).rejects.toThrow();
    await expect(fs.access(path.join(dir, "m.gguf"))).rejects.toThrow();
  });
});
