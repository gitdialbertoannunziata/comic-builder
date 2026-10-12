import { describe, expect, it } from "vitest";
import { FLUX2_KLEIN_4B, type RenderSpec } from "@comic-builder/core";
import { LocalSdImageService, engineTrouble } from "../src/localService.js";
import { ImageCancelledError, ImageError } from "../src/service.js";
import { runRenderQueue } from "../src/renderQueue.js";

const spec: RenderSpec = {
  panel: "ep001-p001-01",
  target: "digital-page",
  width: 1168,
  height: 896,
  aspect: "4:3",
  prompt: "Wordless comic panel",
  seed: 42,
  model: FLUX2_KLEIN_4B,
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
const PNG = btoa(String.fromCharCode(137, 80, 78, 71));

/** Un sd-server finto: registra le chiamate e risponde secondo `script`, uno stato per ogni interrogazione. */
function fakeServer(states: Array<Record<string, unknown>>, submit: { status: number; body?: unknown } = { status: 202, body: { id: "job_1", status: "queued", poll_url: "/sdcpp/v1/jobs/job_1" } }) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/sdcpp/v1/img_gen")) return json(submit.status, submit.body ?? {});
    if (url.endsWith("/cancel")) return json(200, { status: "cancelled" });
    if (url.endsWith("/sdcpp/v1/capabilities")) return json(200, { model: { stem: "flux-2-klein-4b-Q8_0" }, supported_modes: ["img_gen"] });
    return json(200, states[Math.min(polls++, states.length - 1)]);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const options = (fetchImpl: typeof fetch) => ({ baseUrl: "http://127.0.0.1:1234/", fetchImpl, sleep: async () => {}, pollMs: 0 });

describe("Motore locale (stable-diffusion.cpp, sd-server)", () => {
  it("invia lo spec com'è: prompt, misure, seed, riferimenti nell'ordine, 4 passi a guida 1; poi interroga finché è pronta", async () => {
    const server = fakeServer([{ status: "queued", queue_position: 1 }, { status: "generating" }, { status: "completed", result: { output_format: "png", images: [{ b64_json: PNG }] } }]);
    const result = await new LocalSdImageService(options(server.fetchImpl)).generate({ spec, references });
    expect([...result.data]).toEqual([137, 80, 78, 71]);
    expect(result.meta).toMatchObject({ model: FLUX2_KLEIN_4B, costUsd: 0, remoteId: "job_1" });
    const [submit] = server.calls;
    expect(submit!.url).toBe("http://127.0.0.1:1234/sdcpp/v1/img_gen");
    expect(submit!.body).toMatchObject({ prompt: spec.prompt, width: 1168, height: 896, seed: 42, batch_count: 1, sample_params: { sample_steps: 4, guidance: { txt_cfg: 1 } } });
    expect((submit!.body as { ref_images: string[] }).ref_images).toEqual(["data:image/png;base64,AQID", "data:image/png;base64,AgID"]);
    expect(server.calls.filter((c) => c.url.endsWith("/jobs/job_1"))).toHaveLength(3);
  });

  it("fermare la coda annulla il lavoro anche sul server", async () => {
    const server = fakeServer([{ status: "generating" }]);
    const controller = new AbortController();
    const service = new LocalSdImageService({ ...options(server.fetchImpl), sleep: async () => controller.abort() });
    await expect(service.generate({ spec, references, signal: controller.signal })).rejects.toBeInstanceOf(ImageCancelledError);
    expect(server.calls.some((c) => c.url.endsWith("/sdcpp/v1/jobs/job_1/cancel") && c.method === "POST")).toBe(true);
  });

  it("un lavoro fallito dice perché, e non si riprova", async () => {
    const server = fakeServer([{ status: "failed", error: { code: "generation_failed", message: "out of memory" } }]);
    const error = await new LocalSdImageService(options(server.fetchImpl)).generate({ spec, references }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageError);
    expect((error as ImageError).message).toContain("out of memory");
    expect((error as ImageError).retryable).toBe(false);
  });

  it("un guasto porta con sé le righe del motore, non l'avanzamento del campionamento", async () => {
    const server = fakeServer([{ status: "failed", error: { code: "generation_failed", message: "generate_image returned no results" } }]);
    const engineLog = ["\u001b[32m[INFO ] loading model\u001b[0m", "  |==================> | 3/4 - 2.10s/it", "[ERROR] failed to allocate compute buffer for vae decode"].join("\r");
    const service = new LocalSdImageService({ ...options(server.fetchImpl), engineLog: () => engineLog });
    const error = await service.generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect(error.message).toContain("generate_image returned no results");
    expect(error.message).toContain("failed to allocate compute buffer for vae decode");
    expect(error.message).not.toContain("s/it");
    // La memoria è l'unico guasto di cui l'app conosce il rimedio: lo dice.
    expect(error.message).toMatch(/variante compatta/);
  });

  it("un log che non si lascia leggere non diventa il secondo errore", async () => {
    const server = fakeServer([{ status: "failed", error: { code: "generation_failed", message: "generate_image returned no results" } }]);
    const service = new LocalSdImageService({ ...options(server.fetchImpl), engineLog: () => Promise.reject(new Error("motore spento")) });
    const error = await service.generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect(error.message).toBe("Il motore locale non è riuscito a generare: generate_image returned no results.");
  });

  it("coda piena: si riprova dopo un attimo; motore spento: si dice, senza riprovare", async () => {
    const full = fakeServer([], { status: 429, body: {} });
    const busy = await new LocalSdImageService(options(full.fetchImpl)).generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect([busy.retryable, busy.retryAfterMs]).toEqual([true, 2000]);
    const down = new LocalSdImageService({ ...options((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch) });
    const off = await down.generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect(off.message).toBe("Il motore locale non risponde su http://127.0.0.1:1234: è avviato?");
    expect(off.retryable).toBe(false);
    const proxied = new LocalSdImageService(options((async () => new Response("connect ECONNREFUSED", { status: 502 })) as typeof fetch));
    expect((await proxied.check().catch((e: unknown) => e as ImageError)).message).toBe("Il motore locale non risponde su http://127.0.0.1:1234: è avviato?");
  });

  it("un motore spento a metà lavoro porta con sé quello che aveva scritto", async () => {
    const down = (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    const service = new LocalSdImageService({ ...options(down), engineLog: async () => "[ERROR] out of memory allocating VAE buffer" });
    const error = await service.generate({ spec, references }).catch((e: unknown) => e as ImageError);
    expect(error.message).toBe(
      "Il motore locale non risponde su http://127.0.0.1:1234: è avviato? Il motore ha scritto: «[ERROR] out of memory allocating VAE buffer»",
    );
  });

  it("al massimo quattro riferimenti, gratis, e dice quale modello ha caricato", async () => {
    const server = fakeServer([]);
    const service = new LocalSdImageService(options(server.fetchImpl));
    expect(service.maxReferences).toBe(4);
    expect(service.estimate(spec).usd).toBe(0);
    const five = Array.from({ length: 5 }, (_, i) => ({ path: `r${i}.png`, data: new Uint8Array([i]), mediaType: "image/png" }));
    await expect(service.generate({ spec, references: five })).rejects.toThrow(/al massimo 4/);
    expect(await service.check()).toEqual({ model: "flux-2-klein-4b-Q8_0", modes: ["img_gen"] });
  });

  it("l'indirizzo si chiede alla prima richiesta, una volta sola: nell'app desktop il motore parte lì", async () => {
    const server = fakeServer([{ status: "completed", result: { images: [{ b64_json: PNG }] } }]);
    let started = 0;
    const service = new LocalSdImageService({
      fetchImpl: server.fetchImpl,
      sleep: async () => {},
      resolveBaseUrl: async () => {
        started++;
        return "http://127.0.0.1:4321/";
      },
    });
    expect(started).toBe(0);
    await service.check();
    await service.generate({ spec, references });
    expect(started).toBe(1);
    expect(server.calls.every((c) => c.url.startsWith("http://127.0.0.1:4321/sdcpp/v1/"))).toBe(true);
  });

  it("passa dalla stessa coda dei fornitori cloud", async () => {
    const server = fakeServer([{ status: "completed", result: { images: [{ b64_json: PNG }] } }]);
    const outcomes = await runRenderQueue([{ id: "a", request: () => ({ spec, references }) }], { service: new LocalSdImageService(options(server.fetchImpl)) });
    expect(outcomes[0]?.status).toBe("done");
  });
});

describe("engineTrouble — le righe del motore che spiegano un guasto", () => {
  it("spezza anche l'avanzamento riscritto con \\r, toglie i colori e tiene le ultime righe vere", () => {
    const log = [
      "\u001b[32m[INFO ] loading model from flux-2-klein-4b-Q8_0.gguf\u001b[0m",
      "  |====> | 1/4 - 1.90s/it",
      "  |=======> | 2/4 - 2.00s/it",
      "[ERROR] vae decode failed",
    ].join("\r");
    expect(engineTrouble(log)).toEqual(["[INFO ] loading model from flux-2-klein-4b-Q8_0.gguf", "[ERROR] vae decode failed"]);
    expect(engineTrouble(log, 1)).toEqual(["[ERROR] vae decode failed"]);
    expect(engineTrouble("")).toEqual([]);
  });
});
