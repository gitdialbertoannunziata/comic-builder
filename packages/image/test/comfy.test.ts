import { describe, expect, it } from "vitest";
import type { RenderSpec } from "@comic-builder/core";
import { ComfyUiImageService, DEFAULT_COMFY_WORKFLOW, comfyModelName, comfyReferenceSlots, fillComfyWorkflow, parseComfyWorkflow } from "../src/comfyService.js";
import { ImageCancelledError, ImageError } from "../src/service.js";
import { runRenderQueue } from "../src/renderQueue.js";

const spec: RenderSpec = {
  panel: "ep001-p001-01",
  target: "digital-page",
  width: 1168,
  height: 896,
  aspect: "4:3",
  prompt: "Wordless comic panel \"quoted\"",
  seed: 42,
  model: "comfyui:test",
  prompt_upsampling: false,
  output_format: "png",
  references: [
    { kind: "style", ref: "style", path: "style/a.png" },
    { kind: "character", ref: "sara", path: "characters/sara/a.png" },
  ],
  control_image: null,
  compiler: 2,
};
const references = spec.references.map((r, i) => ({ path: r.path, data: new Uint8Array([i + 1, 2, 3]), mediaType: "image/png" }));

/** Un ComfyUI finto: registra le chiamate; lo storico resta vuoto per `pending` interrogazioni, poi risponde `entry`. */
function fakeComfy(entry: Record<string, unknown>, options: { pending?: number; reject?: { status: number; body: unknown }; running?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let polls = 0;
  let uploads = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const isJson = typeof init?.body === "string";
    calls.push({ url, method: init?.method ?? "GET", body: isJson ? JSON.parse(String(init!.body)) : init?.body ?? null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const path = new URL(url).pathname;
    if (path === "/upload/image") return json(200, { name: `ref${++uploads}.png`, subfolder: "comic-builder", type: "input" });
    if (path === "/prompt") return options.reject ? json(options.reject.status, options.reject.body) : json(200, { prompt_id: "p1", number: 1, node_errors: {} });
    if (path === "/history/p1") return json(200, polls++ < (options.pending ?? 0) ? {} : { p1: entry });
    if (path === "/view") return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
    if (path === "/queue") return init?.method === "POST" ? json(200, {}) : json(200, { queue_running: options.running ? [[1, "p1", {}, {}, []]] : [], queue_pending: [] });
    if (path === "/interrupt") return json(200, {});
    return json(404, {});
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const done = { status: { status_str: "success", completed: true, messages: [] }, outputs: { "12": { images: [{ filename: "comic-builder_00001_.png", subfolder: "", type: "output" }] } } };
const options = (fetchImpl: typeof fetch) => ({ baseUrl: "http://127.0.0.1:8188/", fetchImpl, sleep: async () => {}, pollMs: 0 });

describe("Flusso ComfyUI", () => {
  it("il flusso di partenza è FLUX.2 [klein] 4B con quattro posti di riferimento", () => {
    const workflow = parseComfyWorkflow("");
    expect(comfyReferenceSlots(workflow)).toEqual([1, 2, 3, 4]);
    expect(comfyModelName(workflow)).toMatch(/^comfyui:flux-2-klein-4b@[0-9a-f]{8}$/);
  });

  it("riconosce il formato dell'editor e i segnaposto con buchi", () => {
    expect(() => parseComfyWorkflow(JSON.stringify({ nodes: [], links: [] }))).toThrow(/Export \(API\)/);
    expect(() => parseComfyWorkflow("{ non è json")).toThrow(ImageError);
    const gap = { "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } }, "2": { class_type: "LoadImage", inputs: { image: "{{image_2}}" } } };
    expect(() => parseComfyWorkflow(JSON.stringify(gap))).toThrow(/image_1/);
  });

  it("un flusso diverso è un modello diverso", () => {
    const a = parseComfyWorkflow(DEFAULT_COMFY_WORKFLOW);
    const b = parseComfyWorkflow(DEFAULT_COMFY_WORKFLOW.replace('"steps": 4', '"steps": 8'));
    expect(comfyModelName(a)).not.toBe(comfyModelName(b));
  });

  it("riempie i segnaposto: numeri per seed e misure, testo per il prompt", () => {
    const graph = fillComfyWorkflow(parseComfyWorkflow(""), { prompt: "ciao", seed: 7, width: 512, height: 768, images: ["a.png", "b.png", "c.png", "d.png"] });
    expect(graph["4"]!.inputs.text).toBe("ciao");
    expect(graph["9"]!.inputs.noise_seed).toBe(7);
    expect(graph["8"]!.inputs).toMatchObject({ width: 512, height: 768 });
    expect(graph["240"]!.inputs.image).toBe("d.png");
    expect(graph["5"]!.inputs.conditioning).toEqual(["242", 0]);
  });

  it("con meno riferimenti dei posti toglie i nodi vuoti e ricollega la catena", () => {
    const graph = fillComfyWorkflow(parseComfyWorkflow(""), { prompt: "p", seed: 1, width: 64, height: 64, images: ["a.png", "b.png"] });
    for (const id of ["230", "231", "232", "240", "241", "242"]) expect(graph[id]).toBeUndefined();
    expect(graph["5"]!.inputs.conditioning).toEqual(["222", 0]);
    const none = fillComfyWorkflow(parseComfyWorkflow(""), { prompt: "p", seed: 1, width: 64, height: 64, images: [] });
    expect(none["5"]!.inputs.conditioning).toEqual(["4", 0]);
    expect(Object.values(none).some((n) => n.class_type === "LoadImage")).toBe(false);
  });

  it("se il salvataggio dipende da un riferimento vuoto, lo dice", () => {
    const workflow = parseComfyWorkflow(JSON.stringify({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
      "2": { class_type: "LoadImage", inputs: { image: "{{image_1}}" } },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
    }));
    expect(() => fillComfyWorkflow(workflow, { prompt: "p", seed: 1, width: 64, height: 64, images: [] })).toThrow(/SaveImage/);
  });
});

describe("Servizio ComfyUI", () => {
  it("carica i riferimenti, accoda il grafo riempito, aspetta lo storico e scarica l'immagine", async () => {
    const server = fakeComfy(done, { pending: 2 });
    const service = new ComfyUiImageService(options(server.fetchImpl));
    expect(service.maxReferences).toBe(4);
    const result = await service.generate({ spec, references });
    expect([...result.data]).toEqual([137, 80, 78, 71]);
    expect(result.meta).toMatchObject({ costUsd: 0, remoteId: "p1", model: service.model });

    expect(server.calls.filter((c) => c.url.endsWith("/upload/image"))).toHaveLength(2);
    const submit = server.calls.find((c) => c.url.endsWith("/prompt"))!;
    const prompt = (submit.body as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;
    expect(prompt["4"]!.inputs.text).toBe(spec.prompt);
    expect(prompt["210"]!.inputs.image).toBe("comic-builder/ref1.png");
    expect(prompt["220"]!.inputs.image).toBe("comic-builder/ref2.png");
    expect(prompt["230"]).toBeUndefined();
    expect(prompt["8"]!.inputs).toMatchObject({ width: 1168, height: 896 });
    expect(server.calls.filter((c) => c.url.includes("/history/p1"))).toHaveLength(3);
    expect(server.calls.at(-1)!.url).toContain("/view?filename=comic-builder_00001_.png");
  });

  it("il caricamento è multipart, con il nome dato dal contenuto", async () => {
    const server = fakeComfy(done);
    await new ComfyUiImageService(options(server.fetchImpl)).generate({ spec, references: references.slice(0, 1) });
    const upload = server.calls.find((c) => c.url.endsWith("/upload/image"))!;
    const text = new TextDecoder().decode(upload.body as Uint8Array);
    expect(text).toMatch(/name="subfolder"\r\n\r\ncomic-builder/);
    expect(text).toMatch(/filename="[0-9a-f]{24}\.png"/);
  });

  it("gli errori di convalida si leggono per nodo, e un file mancante ha il suo consiglio", async () => {
    const server = fakeComfy(done, {
      reject: { status: 400, body: { error: { message: "Prompt outputs failed validation" }, node_errors: { "1": { class_type: "UNETLoader", errors: [{ type: "value_not_in_list", message: "Value not in list", details: "unet_name: 'x' not in []" }] } } } },
    });
    const error = await new ComfyUiImageService(options(server.fetchImpl)).generate({ spec, references }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageError);
    expect((error as ImageError).message).toMatch(/UNETLoader: Value not in list/);
    expect((error as ImageError).message).toMatch(/Verifica ComfyUI/);
    expect((error as ImageError).retryable).toBe(false);
  });

  it("un errore di esecuzione dice il nodo e, se è la memoria, il rimedio", async () => {
    const server = fakeComfy({ status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "SamplerCustomAdvanced", exception_message: "CUDA out of memory" }]] }, outputs: {} });
    await expect(new ComfyUiImageService(options(server.fetchImpl)).generate({ spec, references })).rejects.toThrow(/SamplerCustomAdvanced: CUDA out of memory.*memoria della GPU/);
  });

  it("fermare toglie dalla coda il lavoro in attesa, e interrompe solo se è il nostro in corso", async () => {
    for (const running of [false, true]) {
      const server = fakeComfy(done, { pending: 100, running });
      const controller = new AbortController();
      let polls = 0;
      const service = new ComfyUiImageService({ ...options(server.fetchImpl), sleep: async () => { if (++polls === 2) controller.abort(); } });
      await expect(service.generate({ spec, references, signal: controller.signal })).rejects.toBeInstanceOf(ImageCancelledError);
      const interrupted = server.calls.some((c) => c.url.endsWith("/interrupt"));
      const deleted = server.calls.some((c) => c.url.endsWith("/queue") && c.method === "POST" && JSON.stringify(c.body) === JSON.stringify({ delete: ["p1"] }));
      expect({ interrupted, deleted }).toEqual(running ? { interrupted: true, deleted: false } : { interrupted: false, deleted: true });
    }
  });

  it("ComfyUI spento: un messaggio che dice cosa fare, senza ritentare", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const error = await new ComfyUiImageService(options(fetchImpl)).generate({ spec, references }).catch((e: unknown) => e);
    expect((error as ImageError).message).toMatch(/ComfyUI non risponde su http:\/\/127\.0\.0\.1:8188/);
    expect((error as ImageError).retryable).toBe(false);
  });

  it("la verifica trova i nodi sconosciuti e i file di modello che mancano", async () => {
    const fetchImpl = (async (url: string) => {
      const path = new URL(url).pathname;
      const body = path === "/system_stats"
        ? { system: { comfyui_version: "0.9.0" }, devices: [{ name: "cuda:0 RTX", vram_total: 12 * 1024 ** 3 }] }
        : {
            UNETLoader: { input: { required: { unet_name: [["altro.safetensors"]], weight_dtype: [["default", "fp8"]] } } },
            CLIPLoader: { input: { required: { clip_name: ["COMBO", { options: ["qwen_3_4b.safetensors"] }], type: [["flux2"]] }, optional: { device: [["default"]] } } },
            VAELoader: { input: { required: { vae_name: [["flux2-vae.safetensors"]] } } },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const info = await new ComfyUiImageService(options(fetchImpl)).check();
    expect(info.version).toBe("0.9.0");
    expect(info.device).toBe("cuda:0 RTX · 12 GB");
    expect(info.missingValues).toEqual([{ node: "UNETLoader", input: "unet_name", value: "flux-2-klein-4b.safetensors" }]);
    expect(info.missingNodes).toContain("Flux2Scheduler");
    expect(info.missingNodes).not.toContain("UNETLoader");
  });
});

describe("Servizio ComfyUI — dopo l'accodamento non si rimanda il lavoro", () => {
  /** Un ComfyUI che risponde a `/history` e `/view` come dicono `history` e `view`, una risposta per chiamata. */
  function flaky(history: Array<() => Response | Promise<Response>>, view: Array<() => Response> = [() => new Response(new Uint8Array([1]))]) {
    const calls: Array<{ path: string; method: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init?.method ?? "GET" });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === "/upload/image") return json({ name: "r.png", subfolder: "comic-builder" });
      if (path === "/prompt") return json({ prompt_id: "p1" });
      if (path === "/queue") return init?.method === "POST" ? json({}) : json({ queue_running: [], queue_pending: [] });
      if (path === "/history/p1") return (history.length > 1 ? history.shift()! : history[0]!)();
      if (path === "/view") return (view.length > 1 ? view.shift()! : view[0]!)();
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    return { calls, fetchImpl, submits: () => calls.filter((c) => c.path === "/prompt").length, removed: () => calls.some((c) => c.path === "/queue" && c.method === "POST") };
  }
  const ok = () => new Response(JSON.stringify({ p1: done }), { status: 200 });
  const busy = () => new Response("overloaded", { status: 503 });

  it("un 5xx passeggero nello storico si riprova sullo stesso lavoro", async () => {
    const server = flaky([busy, busy, ok]);
    const result = await new ComfyUiImageService(options(server.fetchImpl)).generate({ spec, references });
    expect([...result.data]).toEqual([1]);
    expect(server.submits()).toBe(1);
  });

  it("un download che non riesce mai: un solo invio anche con la coda che riprova, e il lavoro si toglie", async () => {
    const server = flaky([ok], [() => new Response("", { status: 500 })]);
    const outcomes = await runRenderQueue([{ id: "a", request: () => ({ spec, references }) }], { service: new ComfyUiImageService(options(server.fetchImpl)), retries: 5, sleep: async () => {} });
    expect(outcomes[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(server.submits()).toBe(1);
    expect(server.removed()).toBe(true);
  });

  it("una chiamata appesa scade, e il lavoro si toglie invece di restare sulla GPU", async () => {
    const hang = () => new Promise<Response>(() => {});
    const server = flaky([hang]);
    const hangingFetch = ((url: string, init?: RequestInit) =>
      new URL(url).pathname === "/history/p1"
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
        : server.fetchImpl(url, init)) as typeof fetch;
    const error = await new ComfyUiImageService({ ...options(hangingFetch), requestTimeoutMs: 10 }).generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect(error).toBeInstanceOf(ImageError);
    expect(error.message).toMatch(/non ha risposto in tempo/);
    expect(error.retryable).toBe(false);
    expect(server.submits()).toBe(1);
    expect(server.removed()).toBe(true);
  });
});
