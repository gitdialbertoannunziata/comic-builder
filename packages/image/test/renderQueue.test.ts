import { describe, expect, it } from "vitest";
import type { RenderSpec } from "@comic-builder/core";
import { MockImageService } from "../src/mockService.js";
import { estimateQueue, runRenderQueue, type RenderJob, type RenderOutcome } from "../src/renderQueue.js";
import { ImageError } from "../src/service.js";
import { FluxImageService } from "../src/fluxService.js";

const spec = (panel: string): RenderSpec => ({
  panel,
  target: "digital-page",
  width: 1024,
  height: 1024,
  aspect: "1:1",
  prompt: "p",
  seed: 1,
  model: "mock-image",
  prompt_upsampling: false,
  output_format: "png",
  references: [],
  control_image: null,
  compiler: 1,
});
const jobs = (n: number): RenderJob[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, request: () => ({ spec: spec(`p${i}`), references: [] }) }));
const noSleep = () => Promise.resolve();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("RenderQueue (§9.3)", () => {
  it("esegue tutto, con gli esiti nell'ordine dei lavori", async () => {
    const service = new MockImageService();
    const outcomes = await runRenderQueue(jobs(5), { service, sleep: noSleep });
    expect(outcomes.map((o) => [o.id, o.status])).toEqual([0, 1, 2, 3, 4].map((i) => [`p${i}`, "done"]));
  });

  it("non supera la concorrenza dichiarata", async () => {
    const service = new MockImageService();
    let active = 0;
    let peak = 0;
    service.before = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
    };
    await runRenderQueue(jobs(7), { service, concurrency: 3, sleep: noSleep });
    expect(peak).toBe(3);
  });

  it("riprova gli errori temporanei, non quelli definitivi", async () => {
    const service = new MockImageService();
    service.before = (request, attempt) => {
      if (request.spec.panel === "p0" && attempt < 3) throw new ImageError("sovraccarico", "mock", true);
      if (request.spec.panel === "p1") throw new ImageError("credito esaurito", "mock");
    };
    const outcomes = await runRenderQueue(jobs(2), { service, sleep: noSleep });
    expect(outcomes[0]).toMatchObject({ status: "done", attempts: 3 });
    expect(outcomes[1]).toMatchObject({ status: "failed", attempts: 1, error: "credito esaurito" });
  });

  it("si arrende dopo i tentativi concessi, e gli altri lavori proseguono", async () => {
    const service = new MockImageService();
    service.before = (request) => {
      if (request.spec.panel === "p0") throw new ImageError("sovraccarico", "mock", true);
    };
    const outcomes = await runRenderQueue(jobs(2), { service, retries: 1, sleep: noSleep });
    expect(outcomes[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(outcomes[1]?.status).toBe("done");
  });

  it("se il fornitore dice quanto aspettare, la coda aspetta quello", async () => {
    const service = new MockImageService();
    service.before = (_request, attempt) => {
      if (attempt === 1) throw new ImageError("limite al minuto", "mock", true, undefined, 15_000);
    };
    const waits: number[] = [];
    await runRenderQueue(jobs(1), { service, sleep: (ms) => Promise.resolve(void waits.push(ms)) });
    expect(waits).toEqual([15_000]);
  });

  it("annullata: ciò che è finito resta, il resto non parte", async () => {
    const service = new MockImageService();
    const controller = new AbortController();
    const seen: RenderOutcome[] = [];
    const outcomes = await runRenderQueue(jobs(4), {
      service,
      concurrency: 1,
      signal: controller.signal,
      sleep: noSleep,
      onOutcome: (outcome) => {
        seen.push(outcome);
        if (seen.length === 2) controller.abort();
      },
    });
    expect(outcomes.map((o) => o.status)).toEqual(["done", "done", "cancelled", "cancelled"]);
    expect(service.requests).toHaveLength(2);
  });

  it("stima spesa e tempo prima di partire", () => {
    const flux = new FluxImageService({ apiKey: "k" });
    const estimate = estimateQueue(flux, [spec("a"), spec("b"), spec("c"), spec("d")], 2);
    expect(estimate.count).toBe(4);
    expect(estimate.usd).toBeCloseTo(0.12);
    expect(estimate.seconds).toBe(24);
  });

  it("non invia una richiesta annullata mentre si preparavano i riferimenti", async () => {
    const service = new MockImageService();
    const controller = new AbortController();
    const gate = deferred();
    const pending = runRenderQueue([{ id: "p0", request: async () => { await gate.promise; return { spec: spec("p0"), references: [] }; } }], { service, signal: controller.signal });
    controller.abort();
    gate.resolve();
    expect(await pending).toEqual([{ id: "p0", status: "cancelled" }]);
    expect(service.requests).toHaveLength(0);
  });

  it("lascia finire il render locale attivo e annulla solo quelli successivi", async () => {
    const service = new MockImageService();
    const controller = new AbortController();
    const started = deferred();
    const gate = deferred();
    service.before = async (request) => {
      expect(request.signal).toBeUndefined();
      started.resolve();
      await gate.promise;
    };
    let finished = false;
    const pending = runRenderQueue(jobs(2), { service, concurrency: 1, signal: controller.signal, cancelInFlight: false });
    void pending.then(() => { finished = true; });
    await started.promise;
    controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    expect((await pending).map((outcome) => outcome.status)).toEqual(["done", "cancelled"]);
    expect(service.requests).toHaveLength(1);
  });

  it("attende tutti i render attivi anche quando un salvataggio fallisce", async () => {
    const service = new MockImageService();
    const started = deferred();
    const gate = deferred();
    service.before = async (request) => {
      if (request.spec.panel === "p1") { started.resolve(); await gate.promise; }
    };
    let finished = false;
    const pending = runRenderQueue(jobs(2), {
      service, concurrency: 2,
      onOutcome: (outcome) => { if (outcome.id === "p0") throw new Error("disk full"); },
    });
    const failure = expect(pending).rejects.toThrow("disk full");
    void pending.catch(() => { finished = true; });
    await started.promise;
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await failure;
    expect(service.requests).toHaveLength(2);
  });
});
