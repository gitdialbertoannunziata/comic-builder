import { t } from "./i18n.js";
export type GenerationLane = "local" | "online-text" | "online-image";
export type GenerationKind = "text" | "image";

export interface GenerationJob {
  id: number;
  lane: GenerationLane;
  label: string;
  state: "queued" | "running";
}

interface PendingJob {
  info: GenerationJob;
  controller: AbortController;
  execute: () => Promise<void>;
  cancel: () => void;
}

export interface GenerationOptions {
  signal?: AbortSignal;
  isValid?: () => boolean;
}

export function generationLane(service: string, kind: GenerationKind): GenerationLane | null {
  if (service === "mock") return null;
  if (service === "local" || service === "ollama") return "local";
  return kind === "text" ? "online-text" : "online-image";
}

export class GenerationScheduler {
  private nextId = 0;
  private jobs: PendingJob[] = [];
  private active = new Set<GenerationLane>();
  private listeners = new Set<() => void>();
  private snapshot: readonly GenerationJob[] = [];

  getSnapshot = (): readonly GenerationJob[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  cancel(id: number): void {
    this.jobs.find((job) => job.info.id === id)?.cancel();
  }

  enqueue<Result>(lane: GenerationLane, label: string, run: (signal: AbortSignal) => Promise<Result>, options: GenerationOptions = {}): Promise<Result> {
    if (options.signal?.aborted) return Promise.reject(new DOMException(t("Generazione annullata."), "AbortError"));
    return new Promise<Result>((resolve, reject) => {
      const controller = new AbortController();
      const cleanup = () => options.signal?.removeEventListener("abort", job.cancel);
      const job: PendingJob = {
        info: { id: ++this.nextId, lane, label, state: "queued" },
        controller,
        cancel: () => {
          controller.abort();
          if (job.info.state === "running") return;
          this.jobs = this.jobs.filter((pending) => pending !== job);
          cleanup();
          reject(new DOMException(t("Generazione annullata."), "AbortError"));
          this.publish();
        },
        execute: async () => {
          try {
            if (options.isValid && !options.isValid()) throw new Error(t("Il progetto o il contenuto del lavoro in coda e' cambiato. Rilancia la generazione."));
            resolve(await run(controller.signal));
          } catch (error) {
            reject(error);
          } finally {
            cleanup();
            this.jobs = this.jobs.filter((pending) => pending !== job);
            this.active.delete(lane);
            this.publish();
            this.drain(lane);
          }
        },
      };
      options.signal?.addEventListener("abort", job.cancel, { once: true });
      this.jobs.push(job);
      this.publish();
      this.drain(lane);
    });
  }

  private publish(): void {
    this.snapshot = this.jobs.map((job) => ({ ...job.info }));
    this.listeners.forEach((listener) => listener());
  }

  private drain(lane: GenerationLane): void {
    if (this.active.has(lane)) return;
    const job = this.jobs.find((pending) => pending.info.lane === lane);
    if (!job) return;
    this.active.add(lane);
    job.info.state = "running";
    this.publish();
    void job.execute();
  }
}

export const generationScheduler = new GenerationScheduler();

export function scheduleGeneration<Result>(service: string, kind: GenerationKind, label: string, run: (signal: AbortSignal) => Promise<Result>, options: GenerationOptions = {}): Promise<Result> {
  const lane = generationLane(service, kind);
  if (lane) return generationScheduler.enqueue(lane, label, run, options);
  if (options.signal?.aborted) return Promise.reject(new DOMException(t("Generazione annullata."), "AbortError"));
  if (options.isValid && !options.isValid()) return Promise.reject(new Error(t("Il progetto e' cambiato.")));
  return run(options.signal ?? new AbortController().signal);
}