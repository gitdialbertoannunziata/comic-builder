import { ImageCancelledError, ImageError, type ImageRequest, type ImageResult, type ImageService } from "./service.js";

/**
 * RenderQueue (§9.3): concorrenza limitata, retry con attesa crescente,
 * annullamento, stima preventiva con tetto di spesa.
 *
 * La ripresa non ha bisogno di stato proprio: la cache è indirizzata per
 * contenuto (§5.7), quindi chi rilancia una coda interrotta mette in coda
 * solo ciò che non ha ancora un render fresco.
 */
export interface RenderJob {
  id: string;
  /** Preparata solo quando tocca a lei: leggere i riferimenti di cento pannelli prima di partire sarebbe memoria sprecata. */
  request: () => Promise<ImageRequest> | ImageRequest;
}

export type RenderOutcome =
  | { id: string; status: "done"; request: ImageRequest; result: ImageResult; attempts: number }
  | { id: string; status: "failed"; error: string; attempts: number }
  | { id: string; status: "cancelled" };

export interface QueueOptions {
  service: ImageService;
  /** Default 2: sotto il limite del fornitore, e la coda resta annullabile in fretta. */
  concurrency?: number;
  /** Tentativi oltre il primo, solo per gli errori che ha senso riprovare. */
  retries?: number;
  signal?: AbortSignal;
  cancelInFlight?: boolean;
  /** Chiamata a ogni lavoro concluso, nell'ordine in cui finiscono: chi chiama salva subito, non a fine coda. */
  onOutcome?: (outcome: RenderOutcome, progress: { done: number; total: number }) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export interface QueueEstimate {
  count: number;
  usd: number;
  /** Tempo di parete, tenuto conto della concorrenza. */
  seconds: number;
}

export function estimateQueue(service: ImageService, specs: ReadonlyArray<ImageRequest["spec"]>, concurrency = 2): QueueEstimate {
  const each = specs.map((spec) => service.estimate(spec));
  return {
    count: specs.length,
    usd: each.reduce((sum, e) => sum + e.usd, 0),
    seconds: Math.ceil(each.reduce((sum, e) => sum + e.seconds, 0) / Math.max(1, Math.min(concurrency, specs.length || 1))),
  };
}

export async function runRenderQueue(jobs: readonly RenderJob[], options: QueueOptions): Promise<RenderOutcome[]> {
  const { service, signal } = options;
  const retries = options.retries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const outcomes: RenderOutcome[] = new Array<RenderOutcome>(jobs.length);
  let next = 0;
  let done = 0;

  async function runJob(job: RenderJob): Promise<RenderOutcome> {
    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) return { id: job.id, status: "cancelled" };
      try {
        const prepared = await job.request();
        if (signal?.aborted) return { id: job.id, status: "cancelled" };
        const request = { ...prepared };
        if (options.cancelInFlight === false) delete request.signal;
        else if (signal) request.signal = signal;
        const result = await service.generate(request);
        return { id: job.id, status: "done", request, result, attempts: attempt };
      } catch (error) {
        if (error instanceof ImageCancelledError || signal?.aborted) return { id: job.id, status: "cancelled" };
        const retryable = error instanceof ImageError && error.retryable;
        if (!retryable || attempt > retries) {
          return { id: job.id, status: "failed", error: error instanceof Error ? error.message : String(error), attempts: attempt };
        }
        await sleep((error instanceof ImageError ? error.retryAfterMs : undefined) ?? 1000 * 2 ** (attempt - 1));
      }
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const job = jobs[index];
      if (!job) return;
      const outcome = await runJob(job);
      outcomes[index] = outcome;
      done++;
      await options.onOutcome?.(outcome, { done, total: jobs.length });
    }
  }

  const workers = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, jobs.length)) }, worker));
  const failed = workers.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return outcomes;
}
