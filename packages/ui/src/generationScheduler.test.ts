import { describe, expect, it, vi } from "vitest";
import { MemoryProjectStore, renderPaths, type Panel, type RenderSpec } from "@comic-builder/core";
import { MockImageService } from "@comic-builder/image";
import { GenerationScheduler, generationLane } from "./generationScheduler.js";
import { generatePanels, generationContentMatches } from "./editor/generateArt.js";

vi.mock("./editor/useArtWatcher.js", () => ({ imageSize: async () => null }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("generation scheduler", () => {
  it("serializes entire local jobs and preserves FIFO", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const started: string[] = [];
    const text = scheduler.enqueue("local", "text", async () => { started.push("text"); await gate.promise; return 1; });
    const image = scheduler.enqueue("local", "image", async () => { started.push("image"); return 2; });
    const next = scheduler.enqueue("local", "next", async () => { started.push("next"); return 3; });
    expect(started).toEqual(["text"]);
    expect(scheduler.getSnapshot().map((job) => job.state)).toEqual(["running", "queued", "queued"]);
    gate.resolve();
    expect(await Promise.all([text, image, next])).toEqual([1, 2, 3]);
    expect(started).toEqual(["text", "image", "next"]);
    expect(scheduler.getSnapshot()).toEqual([]);
  });

  it("runs the three lanes independently, but groups online text providers", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const started: string[] = [];
    const jobs = (["local", "online-text", "online-image"] as const).map((lane) => scheduler.enqueue(lane, lane, async () => { started.push(lane); await gate.promise; }));
    const extra = scheduler.enqueue(generationLane("anthropic", "text")!, "anthropic", async () => { started.push("anthropic"); });
    expect(started).toEqual(["local", "online-text", "online-image"]);
    expect(generationLane("openai", "text")).toBe("online-text");
    expect(generationLane("ollama", "text")).toBe("local");
    expect(generationLane("mock", "image")).toBeNull();
    gate.resolve();
    await Promise.all([...jobs, extra]);
    expect(started.at(-1)).toBe("anthropic");
  });

  it("removes pending jobs without running them and releases listeners", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const running = scheduler.enqueue("local", "first", async () => gate.promise);
    const controller = new AbortController();
    let called = false;
    const pending = scheduler.enqueue("local", "cancel", async () => { called = true; }, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(scheduler.getSnapshot()).toHaveLength(1);
    gate.resolve();
    await running;
    expect(called).toBe(false);
  });

  it("keeps an aborted active job's turn until it actually finishes", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    let signal!: AbortSignal;
    let nextStarted = false;
    const first = scheduler.enqueue("local", "first", async (current) => { signal = current; await gate.promise; });
    const second = scheduler.enqueue("local", "second", async () => { nextStarted = true; });
    scheduler.cancel(scheduler.getSnapshot()[0]!.id);
    expect(signal.aborted).toBe(true);
    expect(nextStarted).toBe(false);
    gate.resolve();
    await Promise.all([first, second]);
    expect(nextStarted).toBe(true);
  });

  it("advances after failure and never starts stale jobs", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const first = scheduler.enqueue("local", "fails", async () => { await gate.promise; throw new Error("start failed"); });
    let called = false;
    const stale = scheduler.enqueue("local", "stale", async () => { called = true; }, { isValid: () => false });
    const last = scheduler.enqueue("local", "last", async () => 42);
    const failures = [expect(first).rejects.toThrow("start failed"), expect(stale).rejects.toThrow("cambiato")];
    gate.resolve();
    await Promise.all(failures);
    expect(await last).toBe(42);
    expect(called).toBe(false);
    expect(scheduler.getSnapshot()).toEqual([]);
  });

  it("rejects pre-aborted jobs and cleans up subscriptions", async () => {
    const scheduler = new GenerationScheduler();
    const notify = vi.fn();
    const unsubscribe = scheduler.subscribe(notify);
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => 1);
    await expect(scheduler.enqueue("local", "cancelled", run, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.getSnapshot()).toEqual([]);
    await scheduler.enqueue("local", "first", run);
    expect(notify).toHaveBeenCalled();
    unsubscribe();
    notify.mockClear();
    await scheduler.enqueue("local", "second", run);
    expect(notify).not.toHaveBeenCalled();
  });
});

function panelInput(count = 1) {
  const service = new MockImageService();
  const store = new MemoryProjectStore("queue test");
  const items = Array.from({ length: count }, (_, index) => {
    const id = `p${index}`;
    const spec: RenderSpec = {
      panel: id, target: "digital-page", width: 512, height: 512, aspect: "1:1",
      prompt: "comic panel", seed: index, model: "mock-image", prompt_upsampling: false,
      output_format: "png", references: [], control_image: null, compiler: 2,
    };
    return { pageId: "page", panel: { id, render: {} } as Panel, spec };
  });
  return { service, store, items, run: vi.fn(() => true), endGesture: vi.fn(), concurrency: 1 };
}

describe("queued image pipeline", () => {
  it("preserves clicked model and resolution while detecting actual content changes", () => {
    const queued = panelInput().items[0]!;
    const reconfigured = { ...queued, spec: { ...queued.spec, model: "another-model", width: 1024, height: 1024 } };
    expect(generationContentMatches(reconfigured, queued)).toBe(true);
    expect(generationContentMatches({ ...queued, panel: { ...queued.panel, render: { other: null } } }, queued)).toBe(true);
    expect(generationContentMatches({ ...queued, spec: { ...queued.spec, prompt: "changed action" } }, queued)).toBe(false);
    expect(generationContentMatches({ ...queued, spec: { ...queued.spec, seed: 900 } }, queued)).toBe(false);
    expect(generationContentMatches({ ...queued, pageId: "another-page" }, queued)).toBe(false);
  });
  it("keeps local batch concurrency at one and saves every completed render", async () => {
    const input = panelInput(3);
    const started = deferred();
    const gate = deferred();
    let active = 0;
    let peak = 0;
    input.service.before = async () => {
      peak = Math.max(peak, ++active);
      started.resolve();
      await gate.promise;
      active--;
    };
    const pending = generatePanels(input);
    await started.promise;
    expect(input.service.requests).toHaveLength(1);
    gate.resolve();
    expect(await pending).toMatchObject({ done: 3, cancelled: 0, failed: [] });
    expect(peak).toBe(1);
    expect(input.run).toHaveBeenCalledTimes(3);
    expect(input.endGesture).toHaveBeenCalledOnce();
    for (const item of input.items) expect(await input.store.readBytes(renderPaths(item.spec).image)).not.toBeNull();
  });

  it("does not link a completed image to a changed panel", async () => {
    const input = panelInput();
    let valid = true;
    input.service.before = () => { valid = false; };
    expect(await generatePanels({ ...input, isValid: () => valid })).toMatchObject({ done: 1 });
    expect(input.run).not.toHaveBeenCalled();
    expect(await input.store.readBytes(renderPaths(input.items[0]!.spec).image)).not.toBeNull();
  });

  it("rejects stale or cancelled batches before contacting the service", async () => {
    const stale = panelInput();
    await expect(generatePanels({ ...stale, isValid: () => false })).rejects.toThrow("cambiata");
    expect(stale.service.requests).toHaveLength(0);
    const cancelled = panelInput();
    const controller = new AbortController();
    controller.abort();
    await expect(generatePanels({ ...cancelled, signal: controller.signal })).rejects.toThrow();
    expect(cancelled.service.requests).toHaveLength(0);
  });
});