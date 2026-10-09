import { describe, expect, it } from "vitest";
import type { RenderSpec } from "@comic-builder/core";
import { AzureFluxImageService, azureFluxModel, estimateFluxUsd, FluxImageService } from "../src/fluxService.js";
import { ImageCancelledError, ImageError } from "../src/service.js";

const spec: RenderSpec = {
  panel: "ep001-p001-01",
  target: "digital-page",
  width: 1216,
  height: 832,
  aspect: "3:2",
  prompt: "Comic panel",
  seed: 42,
  model: "flux-2-pro",
  prompt_upsampling: false,
  output_format: "png",
  references: [
    { character: "sara", path: "characters/sara/a.png" },
    { character: "marco", path: "characters/marco/a.png" },
  ],
  control_image: null,
  compiler: 1,
};
const references = spec.references.map((r, i) => ({ path: r.path, data: new Uint8Array([i + 1, 2, 3]), mediaType: "image/png" }));
const flexSpec: RenderSpec = { ...spec, model: "flux-2-flex" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** Una risposta per chiamata, in ordine; registra cosa è stato chiesto. */
function scripted(responses: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      ...(init.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error("nessuna risposta prevista"));
    return Promise.resolve(typeof next === "function" ? next() : next);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const POLL = "https://api.eu1.bfl.ai/v1/get_result?id=abc";
const SAMPLE = "https://delivery-eu1.bfl.ai/results/abc.png?sig=x";
const service = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof FluxImageService>[0]> = {}) =>
  new FluxImageService({ apiKey: "bfl-test", fetchImpl, sleep: () => Promise.resolve(), ...extra });

describe("FluxImageService — forma della richiesta", () => {
  it("invia a /v1/flux-2-pro con x-key, dimensioni, seed e riferimenti in base64 nell'ordine dello spec", async () => {
    const { calls, fetchImpl } = scripted([json({ id: "abc", polling_url: POLL, cost: 6 }), json({ status: "Ready", result: { sample: SAMPLE } }), new Response(new Uint8Array([9, 8, 7]))]);
    const result = await service(fetchImpl).generate({ spec, references });

    const submit = calls[0]!;
    expect(submit.url).toBe("https://api.bfl.ai/v1/flux-2-pro");
    expect(submit.method).toBe("POST");
    expect(submit.headers["x-key"]).toBe("bfl-test");
    expect(submit.body).toMatchObject({ prompt: "Comic panel", seed: 42, width: 1216, height: 832, output_format: "png", disable_pup: true });
    expect(submit.body?.input_image).toBe(btoa("\x01\x02\x03"));
    expect(submit.body?.input_image_2).toBe(btoa("\x02\x02\x03"));
    expect(submit.body?.input_image_3).toBeUndefined();

    expect([...result.data]).toEqual([9, 8, 7]);
    expect(result.mediaType).toBe("image/png");
    // 6 crediti = 0,06 USD: il consuntivo è quello del fornitore.
    expect(result.meta.costUsd).toBeCloseTo(0.06);
    expect(result.meta.remoteId).toBe("abc");
  });

  it("segue il polling_url ricevuto finché è pronta, e scarica l'immagine senza mandare la chiave", async () => {
    const { calls, fetchImpl } = scripted([
      json({ id: "abc", polling_url: POLL }),
      json({ status: "Pending" }),
      json({ status: "Ready", result: { sample: SAMPLE } }),
      new Response(new Uint8Array([1])),
    ]);
    const result = await service(fetchImpl).generate({ spec, references: [] });

    expect(calls.map((c) => c.url)).toEqual(["https://api.bfl.ai/v1/flux-2-pro", POLL, POLL, SAMPLE]);
    expect(calls[1]!.headers["x-key"]).toBe("bfl-test");
    expect(calls[3]!.headers["x-key"]).toBeUndefined();
    expect(result.meta.costUsd).toBeNull();
  });

  it("ogni URL passa da rewriteUrl: è lì che l'host dichiara il proxy", async () => {
    const { calls, fetchImpl } = scripted([json({ polling_url: POLL }), json({ status: "Ready", result: { sample: SAMPLE } }), new Response(new Uint8Array([1]))]);
    await service(fetchImpl, { rewriteUrl: (url) => `/bfl-proxy/${url.replace("https://", "")}`, baseUrl: "https://api.eu.bfl.ai/" }).generate({ spec, references: [] });
    expect(calls[0]!.url).toBe("/bfl-proxy/api.eu.bfl.ai/v1/flux-2-pro");
    expect(calls[2]!.url).toBe(`/bfl-proxy/${SAMPLE.replace("https://", "")}`);
  });

  it("[flex]: la sua rotta, e il divieto di riscrivere il prompt col nome che ha lì", async () => {
    const { calls, fetchImpl } = scripted([json({ polling_url: POLL }), json({ status: "Ready", result: { sample: SAMPLE } }), new Response(new Uint8Array([1]))]);
    await service(fetchImpl).generate({ spec: flexSpec, references });
    expect(calls[0]!.url).toBe("https://api.bfl.ai/v1/flux-2-flex");
    expect(calls[0]!.body).toMatchObject({ prompt: "Comic panel", seed: 42, prompt_upsampling: false });
    expect(calls[0]!.body).not.toHaveProperty("disable_pup");
    expect(calls[0]!.body?.input_image_2).toBe(btoa("\x02\x02\x03"));
  });
});

describe("FluxImageService — errori tradotti in cosa fare", () => {
  const failure = async (responses: Response[]) => {
    const { fetchImpl } = scripted(responses);
    return service(fetchImpl)
      .generate({ spec, references: [] })
      .then(
        () => null,
        (error: unknown) => error as ImageError,
      );
  };

  it("402: credito esaurito, inutile riprovare", async () => {
    const error = await failure([json({}, 402)]);
    expect(error?.message).toMatch(/Credito/);
    expect(error?.retryable).toBe(false);
  });

  it("429 e 5xx: si può riprovare", async () => {
    expect((await failure([json({}, 429)]))?.retryable).toBe(true);
    expect((await failure([json({}, 503)]))?.retryable).toBe(true);
  });

  it("prompt moderato: non si riprova, e si dice cosa cambiare", async () => {
    const error = await failure([json({ polling_url: POLL }), json({ status: "Request Moderated" })]);
    expect(error?.message).toMatch(/filtro di sicurezza/);
    expect(error?.retryable).toBe(false);
  });

  it("troppi riferimenti: rifiutati prima di spendere", async () => {
    const { calls, fetchImpl } = scripted([]);
    const many = Array.from({ length: 9 }, (_, i) => ({ path: `r${i}.png`, data: new Uint8Array([i]), mediaType: "image/png" }));
    await expect(service(fetchImpl).generate({ spec, references: many })).rejects.toThrow(/al massimo 8/);
    expect(calls).toHaveLength(0);
  });

  it("annullata durante l'attesa: esce come annullamento, non come errore del fornitore", async () => {
    const controller = new AbortController();
    const { fetchImpl } = scripted([json({ polling_url: POLL })]);
    const pending = service(fetchImpl, { sleep: () => Promise.resolve(controller.abort()) }).generate({ spec, references: [], signal: controller.signal });
    await expect(pending).rejects.toBeInstanceOf(ImageCancelledError);
  });

  it("senza chiave non si costruisce", () => {
    expect(() => new FluxImageService({ apiKey: " " })).toThrow(/chiave/);
  });
});

describe("Stima della spesa", () => {
  it("0,03 il primo megapixel, 0,015 ogni megapixel in più e ogni riferimento", () => {
    expect(estimateFluxUsd({ width: 1024, height: 1024, references: [] })).toBeCloseTo(0.03);
    expect(estimateFluxUsd(spec)).toBeCloseTo(0.06);
    expect(estimateFluxUsd({ width: 2048, height: 1024, references: [] })).toBeCloseTo(0.045);
  });

  it("[flex]: 0,05 a megapixel, generato o di riferimento", () => {
    expect(estimateFluxUsd({ model: "flux-2-flex", width: 1024, height: 1024, references: [] })).toBeCloseTo(0.05);
    expect(estimateFluxUsd(flexSpec)).toBeCloseTo(0.15);
    expect(estimateFluxUsd({ model: "flux-2-flex", width: 2048, height: 1024, references: [] })).toBeCloseTo(0.1);
  });
});

describe("AzureFluxImageService — FLUX.2 su Azure AI Foundry", () => {
  const ENDPOINT = "https://risorsa.services.ai.azure.com/api/projects/proj-default";
  const azure = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof AzureFluxImageService>[0]> = {}) =>
    new AzureFluxImageService({ apiKey: "az-test", endpoint: ENDPOINT, fetchImpl, ...extra });

  it("dall'endpoint del progetto usa l'origine, e chiama la rotta del fornitore col nome del deployment", async () => {
    const { calls, fetchImpl } = scripted([json({ data: [{ b64_json: btoa("\x09\x08") }], request_meta: { cost: 3 } })]);
    const result = await azure(fetchImpl, { deployment: "flux-mio" }).generate({ spec, references });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://risorsa.services.ai.azure.com/providers/blackforestlabs/v1/flux-2-pro?api-version=preview");
    expect(calls[0]!.headers.Authorization).toBe("Bearer az-test");
    expect(calls[0]!.body).toMatchObject({ model: "flux-mio", prompt: "Comic panel", seed: 42, width: 1216, height: 832, disable_pup: true });
    expect(calls[0]!.body?.input_image_2).toBe(btoa("\x02\x02\x03"));
    expect([...result.data]).toEqual([9, 8]);
    expect(result.meta.costUsd).toBeCloseTo(0.03);
  });

  it("[flex]: il modello dello spec sceglie la rotta, il deployment va nel corpo", async () => {
    const { calls, fetchImpl } = scripted([json({ data: [{ b64_json: btoa("\x09") }], request_meta: { cost: 5 } })]);
    const result = await azure(fetchImpl, { deployment: "FLUX.2-flex" }).generate({ spec: flexSpec, references: [] });

    expect(calls[0]!.url).toBe("https://risorsa.services.ai.azure.com/providers/blackforestlabs/v1/flux-2-flex?api-version=preview");
    expect(calls[0]!.body).toMatchObject({ model: "FLUX.2-flex", prompt_upsampling: false });
    expect(calls[0]!.body).not.toHaveProperty("disable_pup");
    expect(result.meta.model).toBe("FLUX.2-flex");
    expect(result.meta.costUsd).toBeCloseTo(0.05);
  });

  it("dal nome del deployment si riconosce il modello", () => {
    expect(azureFluxModel("FLUX.2-flex")).toBe("flux-2-flex");
    expect(azureFluxModel("prove-Flex-eu")).toBe("flux-2-flex");
    expect(azureFluxModel("FLUX.2-pro")).toBe("flux-2-pro");
    expect(azureFluxModel("flux-mio")).toBe("flux-2-pro");
    expect(azureFluxModel("")).toBe("flux-2-pro");
  });

  it("429: si riprova, dopo il tempo che dice il deployment", async () => {
    const limited = new Response("{}", { status: 429, headers: { "x-ratelimit-reset-requests": "15" } });
    const { fetchImpl } = scripted([limited]);
    const error = await azure(fetchImpl).generate({ spec, references: [] }).then(() => null, (e: unknown) => e as ImageError);
    expect(error?.retryable).toBe(true);
    expect(error?.retryAfterMs).toBe(15_000);
  });

  it("404: il nome del deployment è sbagliato, e lo si dice", async () => {
    const { fetchImpl } = scripted([json({ error: { message: "DeploymentNotFound" } }, 404)]);
    await expect(azure(fetchImpl, { deployment: "x" }).generate({ spec, references: [] })).rejects.toThrow(/deployment «x»/);
  });

  it("risposta senza immagine: non si riprova", async () => {
    const { fetchImpl } = scripted([json({ data: [] })]);
    const error = await azure(fetchImpl).generate({ spec, references: [] }).then(() => null, (e: unknown) => e as ImageError);
    expect(error?.message).toMatch(/senza immagine/);
    expect(error?.retryable).toBe(false);
  });

  it("endpoint non valido: non si costruisce", () => {
    expect(() => new AzureFluxImageService({ apiKey: "k", endpoint: "risorsa" })).toThrow(/endpoint valido/);
  });
});
