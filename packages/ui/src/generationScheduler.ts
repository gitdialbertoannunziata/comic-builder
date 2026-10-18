import { formatUsd, t } from "./i18n.js";
export type GenerationLane = "local" | "online-text" | "online-image";
export type GenerationKind = "text" | "image";

export interface GenerationJob {
  id: number;
  lane: GenerationLane;
  label: string;
  state: "queued" | "running";
  /** Quanto si stima che costi: conta per il tetto di spesa finché il lavoro è in coda o in corso. */
  usd: number;
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
  /**
   * La stima del lavoro e il tetto di spesa. Il tetto vale per tutto ciò che
   * è in coda insieme: dieci clic da 1 $ sotto un tetto di 2 $ non fanno 10 $.
   */
  spend?: { usd: number; capUsd: number };
}

export function generationLane(service: string, kind: GenerationKind): GenerationLane | null {
  if (service === "mock") return null;
  // ComfyUI gira sulla stessa GPU dei modelli locali: una coda sola, o si contendono la memoria.
  if (service === "local" || service === "ollama" || service === "comfyui") return "local";
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

  /** La spesa stimata di ciò che è in coda o in corso. */
  committedUsd(): number {
    return this.jobs.reduce((sum, job) => sum + job.info.usd, 0);
  }

  enqueue<Result>(lane: GenerationLane, label: string, run: (signal: AbortSignal) => Promise<Result>, options: GenerationOptions = {}): Promise<Result> {
    if (options.signal?.aborted) return Promise.reject(new DOMException(t("Generazione annullata."), "AbortError"));
    const usd = Math.max(0, options.spend?.usd ?? 0);
    if (options.spend && usd > 0) {
      const committed = this.committedUsd();
      if (committed + usd > options.spend.capUsd) {
        return Promise.reject(
          new Error(
            committed > 0
              ? t("La stima ({0}), sommata a quanto è già in coda ({1}), supera il tetto di spesa ({2}): aspetta che la coda si svuoti, o alza il tetto.", formatUsd(usd), formatUsd(committed), formatUsd(options.spend.capUsd))
              : t("La stima ({0}) supera il tetto di spesa ({1}).", formatUsd(usd), formatUsd(options.spend.capUsd)),
          ),
        );
      }
    }
    return new Promise<Result>((resolve, reject) => {
      const controller = new AbortController();
      const cleanup = () => options.signal?.removeEventListener("abort", job.cancel);
      const job: PendingJob = {
        info: { id: ++this.nextId, lane, label, state: "queued", usd },
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