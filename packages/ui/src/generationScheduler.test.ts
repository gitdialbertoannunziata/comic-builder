import { describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MemoryProjectStore, renderPaths, type Command, type Panel, type RenderSpec } from "@comic-builder/core";
import { MockImageService } from "@comic-builder/image";
import { GenerationScheduler, generationLane, generationScheduler } from "./generationScheduler.js";
import { useGeneration, type GenerationScope } from "./useGeneration.js";
import { generatePanels, generationContentMatches } from "./editor/generateArt.js";

vi.mock("./editor/useArtWatcher.js", () => ({ imageSize: async () => null }));
vi.mock("./platform/localModels.js", () => ({ localModelIdentity: () => "installed-model" }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function mountGeneration() {
  let generation!: ReturnType<typeof useGeneration>;
  let renderer!: ReactTestRenderer;
  function Probe({ identity }: { identity: string }) {
    generation = useGeneration(identity, "project");
    return null;
  }
  act(() => { renderer = create(createElement(Probe, { identity: "original" })); });
  return {
    get generation() { return generation; },
    unmount: () => act(() => renderer.unmount()),
    replace: () => act(() => renderer.update(createElement(Probe, { identity: "replacement" }))),
  };
}

describe("multiple submissions from the same generation hook", () => {
  it("keeps project-owned image jobs through chapter panel remounts and links their original targets", async () => {
    const input = panelInput(3);
    const gate = deferred();
    const items = input.items.map((item, index) => ({ ...item, pageId: index < 2 ? "chapter-a-page" : "chapter-b-page" }));
    input.service.before = () => gate.promise;
    let generation!: GenerationScope;
    let submit!: (item: typeof items[number]) => Promise<unknown>;
    let renderer!: ReactTestRenderer;
    let remounts = 0;
    function ChapterPanel({ scope, chapter }: { scope: GenerationScope; chapter: string }) {
      const [mountedChapter] = useState(() => { remounts++; return chapter; });
      submit = (item) => scope.schedule("local", "image", `${mountedChapter}/${item.panel.id}`, (signal, isCurrent) => generatePanels({
        ...input, items: [item], signal, cancelInFlight: false,
        run: (command) => isCurrent() && input.run(command),
        isValid: () => isCurrent(),
      }));
      return null;
    }
    function ProjectOwner({ chapter }: { chapter: string | null }) {
      generation = useGeneration(input.store, "project");
      return chapter ? createElement(ChapterPanel, { key: chapter, chapter, scope: generation }) : null;
    }
    act(() => { renderer = create(createElement(ProjectOwner, { chapter: "a" })); });
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    let third!: Promise<unknown>;
    act(() => { first = submit(items[0]!); second = submit(items[1]!); });
    act(() => renderer.update(createElement(ProjectOwner, { chapter: null })));
    expect(generation).toMatchObject({ running: 1, queued: 1 });
    act(() => renderer.update(createElement(ProjectOwner, { chapter: "b" })));
    act(() => { third = submit(items[2]!); });
    expect(remounts).toBe(2);
    expect(generation).toMatchObject({ running: 1, queued: 2 });
    expect(generationScheduler.getSnapshot().map((job) => job.label)).toEqual(["a/p0", "a/p1", "b/p2"]);
    await act(async () => { gate.resolve(); await Promise.all([first, second, third]); });
    expect(input.run.mock.calls.map(([command]) => command)).toEqual(items.map((item) => expect.objectContaining({ type: "panel.update", pageId: item.pageId, panelId: item.panel.id })));
    expect(input.service.requests.map((request) => request.spec.panel)).toEqual(["p0", "p1", "p2"]);
    expect(generation.phase).toBeNull();
    act(() => renderer.unmount());
  });

  it("accepts multiple jobs of the same type and keeps counts until each finishes", async () => {
    const probe = mountGeneration();
    const firstGate = deferred();
    const secondGate = deferred();
    const started: string[] = [];
    let first!: Promise<string>;
    let second!: Promise<string>;
    let third!: Promise<string>;
    act(() => {
      first = probe.generation.schedule("local", "image", "panel one", async () => { started.push("one"); await firstGate.promise; return "one"; });
      second = probe.generation.schedule("local", "image", "panel two", async () => { started.push("two"); await secondGate.promise; return "two"; });
      third = probe.generation.schedule("local", "image", "panel three", async () => { started.push("three"); return "three"; });
    });
    expect(started).toEqual(["one"]);
    expect(probe.generation).toMatchObject({ running: 1, queued: 2, phase: "running" });
    expect(generationScheduler.getSnapshot().map((job) => job.label)).toEqual(["panel one", "panel two", "panel three"]);
    await act(async () => { firstGate.resolve(); expect(await first).toBe("one"); });
    expect(started).toEqual(["one", "two"]);
    expect(probe.generation).toMatchObject({ running: 1, queued: 1, phase: "running" });
    await act(async () => { secondGate.resolve(); expect(await Promise.all([second, third])).toEqual(["two", "three"]); });
    expect(probe.generation).toMatchObject({ running: 0, queued: 0, phase: null });
    expect(generationScheduler.getSnapshot()).toEqual([]);
    probe.unmount();
  });

  it("stops only active jobs and preserves queued jobs and individual cancellation", async () => {
    const probe = mountGeneration();
    const gate = deferred();
    let first!: Promise<string>;
    let second!: Promise<string>;
    let third!: Promise<string>;
    let activeSignal!: AbortSignal;
    const cancelled: string[] = [];
    act(() => {
      first = probe.generation.schedule("local", "image", "active", async (signal) => { activeSignal = signal; await gate.promise; return "first"; }).catch((error: Error) => error.name);
      second = probe.generation.schedule("local", "image", "keep", async () => "second");
      third = probe.generation.schedule("local", "image", "remove", async () => { cancelled.push("unexpected start"); return "third"; }).catch((error: Error) => error.name);
    });
    await act(async () => { generationScheduler.cancel(generationScheduler.getSnapshot().find((job) => job.label === "remove")!.id); expect(await third).toBe("AbortError"); });
    act(() => probe.generation.cancel());
    expect(activeSignal.aborted).toBe(true);
    expect(probe.generation).toMatchObject({ running: 1, queued: 1 });
    await act(async () => { gate.resolve(); expect(await first).toBe("AbortError"); expect(await second).toBe("second"); });
    expect(cancelled).toEqual([]);
    expect(probe.generation.phase).toBeNull();
    probe.unmount();
  });

  it("tracks independent lanes in the same panel without overwriting controllers", async () => {
    const probe = mountGeneration();
    const gate = deferred();
    let promises!: Promise<void>[];
    act(() => {
      promises = [
        probe.generation.schedule("local", "image", "local", () => gate.promise),
        probe.generation.schedule("openai", "text", "text", () => gate.promise),
        probe.generation.schedule("flux", "image", "images", () => gate.promise),
      ];
    });
    expect(probe.generation).toMatchObject({ running: 3, queued: 0 });
    await act(async () => { gate.resolve(); await Promise.all(promises); });
    expect(probe.generation.phase).toBeNull();
    probe.unmount();
  });

  it("cancels all pending jobs on scope change without clearing newer work", async () => {
    const probe = mountGeneration();
    const gate = deferred();
    const newerGate = deferred();
    let first!: Promise<string>;
    let second!: Promise<string>;
    let newer!: Promise<string>;
    const pendingRun = vi.fn(async () => "second");
    act(() => {
      first = probe.generation.schedule("local", "image", "old active", async () => { await gate.promise; return "first"; }).catch((error: Error) => error.name);
      second = probe.generation.schedule("local", "image", "old queued", pendingRun).catch((error: Error) => error.name);
    });
    await act(async () => { probe.replace(); expect(await second).toBe("AbortError"); });
    act(() => { newer = probe.generation.schedule("local", "image", "new", async () => { await newerGate.promise; return "new"; }); });
    expect(probe.generation).toMatchObject({ running: 0, queued: 1 });
    await act(async () => { gate.resolve(); expect(await first).toBe("AbortError"); });
    expect(probe.generation).toMatchObject({ running: 1, queued: 0 });
    expect(pendingRun).not.toHaveBeenCalled();
    await act(async () => { newerGate.resolve(); expect(await newer).toBe("new"); });
    expect(probe.generation.phase).toBeNull();
    probe.unmount();
  });
});

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
    expect(generationLane("comfyui", "image")).toBe("local");
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
  return { service, store, items, run: vi.fn<(command: Command) => boolean>(() => true), endGesture: vi.fn(), concurrency: 1 };
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
describe("Tetto di spesa sulla coda", () => {
  it("conta ciò che è in coda e in corso, e lo libera quando il lavoro finisce", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const first = scheduler.enqueue("online-image", "a", () => gate.promise, { spend: { usd: 1.5, capUsd: 2 } });
    expect(scheduler.committedUsd()).toBe(1.5);
    await expect(scheduler.enqueue("online-image", "b", async () => {}, { spend: { usd: 1, capUsd: 2 } })).rejects.toThrow(/già in coda/);
    // Un lavoro gratis (un motore locale) non tocca il tetto.
    await scheduler.enqueue("local", "c", async () => {}, { spend: { usd: 0, capUsd: 2 } });
    gate.resolve();
    await first;
    expect(scheduler.committedUsd()).toBe(0);
    await expect(scheduler.enqueue("online-image", "d", async () => "ok", { spend: { usd: 1, capUsd: 2 } })).resolves.toBe("ok");
    await expect(scheduler.enqueue("online-image", "e", async () => {}, { spend: { usd: 3, capUsd: 2 } })).rejects.toThrow(/supera il tetto/);
  });

  it("un lavoro annullato mentre aspetta libera la sua parte", async () => {
    const scheduler = new GenerationScheduler();
    const gate = deferred();
    const running = scheduler.enqueue("online-image", "a", () => gate.promise, { spend: { usd: 1, capUsd: 2 } });
    const waiting = scheduler.enqueue("online-image", "b", async () => {}, { spend: { usd: 1, capUsd: 2 } });
    scheduler.cancel(scheduler.getSnapshot()[1]!.id);
    await expect(waiting).rejects.toThrow();
    expect(scheduler.committedUsd()).toBe(1);
    gate.resolve();
    await running;
  });
});
