import { FLUX2_KLEIN_4B, maxReferencesFor, type RenderSpec } from "@comic-builder/core";
import { ImageCancelledError, ImageError, type ImageEstimate, type ImageRequest, type ImageResult, type ImageService } from "./service.js";

/**
 * `ImageService` su un modello locale, servito da `sd-server` di
 * stable-diffusion.cpp: un solo eseguibile C++ (MIT), senza Python e senza
 * ComfyUI, con build per Metal, Vulkan, CUDA e CPU. Il modello di partenza è
 * FLUX.2 [klein] 4B (pesi Apache 2.0): stessa famiglia di [pro], quindi lo
 * stesso spec e lo stesso prompt, con le immagini di riferimento native.
 *
 * Si parla con l'API asincrona nativa (`/sdcpp/v1`): si invia il lavoro, si
 * interroga lo stato finché è finito, e se chi chiama ferma la coda il
 * lavoro si annulla anche sul server — una GPU che continua a calcolare
 * un'immagine che nessuno aspetta è tempo rubato alla successiva.
 *
 * Non costa niente a immagine: la spesa è la corrente e il tempo, e la
 * stima lo dice in secondi.
 */
export interface LocalSdOptions {
  /** Dove ascolta `sd-server`: di norma `http://127.0.0.1:1234`. */
  baseUrl?: string;
  /**
   * Nell'app desktop il motore lo avvia l'app, su una porta che si conosce
   * solo allora: l'indirizzo si chiede qui, alla prima richiesta. Vince su `baseUrl`.
   */
  resolveBaseUrl?: () => Promise<string>;
  /** Il modello che lo spec registra; deve essere quello caricato dal server. */
  model?: string;
  /** Passi e guida: per [klein] distillato bastano 4 passi a guida 1 (la ricetta della documentazione di sd.cpp). */
  steps?: number;
  cfg?: number;
  sampler?: string;
  fetchImpl?: typeof fetch;
  /** Trasforma ogni URL prima della chiamata: dal browser in sviluppo si passa dal proxy di Vite. */
  rewriteUrl?: (url: string) => string;
  pollMs?: number;
  /** Oltre questo tempo senza risultato il lavoro si considera perso: una GPU lenta con molti riferimenti ci mette minuti. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Il lavoro come lo descrive `/sdcpp/v1/jobs/{id}`: solo i campi che servono qui. */
interface Job {
  id?: string;
  status?: "queued" | "generating" | "completed" | "failed" | "cancelled";
  poll_url?: string;
  queue_position?: number;
  result?: { images?: Array<{ b64_json?: string }>; output_format?: string } | null;
  error?: { code?: string; message?: string } | null;
}

export interface LocalEngineInfo {
  /** Il modello caricato, come lo dichiara il server. */
  model: string;
  modes: string[];
}

const DEFAULT_URL = "http://127.0.0.1:1234";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class LocalSdImageService implements ImageService {
  readonly name = "local-sd";
  readonly model: string;
  readonly maxReferences: number;
  private readonly baseUrl: string;

  constructor(private readonly options: LocalSdOptions = {}) {
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_URL).replace(/\/$/, "");
    this.model = options.model ?? FLUX2_KLEIN_4B;
    this.maxReferences = maxReferencesFor(this.model);
  }

  /** Niente da pagare. Il tempo dipende dalla GPU di chi disegna: questa è una scheda di fascia media, e ogni riferimento allunga. */
  estimate(spec: RenderSpec): ImageEstimate {
    const megapixels = (spec.width * spec.height) / (1024 * 1024);
    return { usd: 0, seconds: Math.round(4 * megapixels + 2 * spec.references.length) };
  }

  private resolved: string | null = null;

  /** L'indirizzo del motore: quello dato, o quello che restituisce chi lo avvia. */
  private async base(): Promise<string> {
    if (!this.options.resolveBaseUrl) return this.baseUrl;
    this.resolved ??= (await this.options.resolveBaseUrl()).replace(/\/$/, "");
    return this.resolved;
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `${await this.base()}${path}`;
    try {
      return await fetchImpl(this.options.rewriteUrl ? this.options.rewriteUrl(url) : url, { ...init, ...(signal ? { signal } : {}) });
    } catch (cause) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      // Non si riprova: se il motore non è avviato, cinque tentativi sono solo cinque attese.
      throw new ImageError(`Il motore locale non risponde su ${this.resolved ?? this.baseUrl}: è avviato?`, this.name, false, cause);
    }
  }

  private async json<T>(response: Response, what: string): Promise<T> {
    if (response.status === 429) throw new ImageError("Il motore locale ha la coda piena: riprovo fra poco.", this.name, true, undefined, 2000);
    // Un proxy davanti al motore (il server di sviluppo) risponde 502 quando dietro non c'è nessuno.
    if (response.status === 502 || response.status === 504) throw new ImageError(`Il motore locale non risponde su ${this.resolved ?? this.baseUrl}: è avviato?`, this.name, false);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ImageError(`Il motore locale ha rifiutato ${what} (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`, this.name, response.status >= 500);
    }
    return (await response.json()) as T;
  }

  /** Cosa ha caricato il server: per dire all'autore se è il modello giusto, prima di generare. */
  async check(signal?: AbortSignal): Promise<LocalEngineInfo> {
    const capabilities = await this.json<{ model?: { name?: string; stem?: string; path?: string }; supported_modes?: string[] }>(
      await this.call("/sdcpp/v1/capabilities", { method: "GET", headers: { accept: "application/json" } }, signal),
      "la richiesta delle capacità",
    );
    return { model: capabilities.model?.stem || capabilities.model?.name || capabilities.model?.path || "sconosciuto", modes: capabilities.supported_modes ?? [] };
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const { spec, references, signal } = request;
    if (references.length > this.maxReferences) {
      throw new ImageError(`Il modello locale accetta al massimo ${this.maxReferences} immagini di riferimento: ne sono arrivate ${references.length}.`, this.name);
    }
    const started = Date.now();
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const headers = { "content-type": "application/json", accept: "application/json" };

    const body = {
      prompt: spec.prompt,
      width: spec.width,
      height: spec.height,
      seed: spec.seed,
      batch_count: 1,
      // Nello stesso ordine dello spec: il prompt le chiama «image 1», «image 2»…
      ref_images: references.map((r) => `data:${r.mediaType};base64,${toBase64(r.data)}`),
      sample_params: {
        sample_steps: this.options.steps ?? 4,
        sample_method: this.options.sampler ?? "euler",
        guidance: { txt_cfg: this.options.cfg ?? 1 },
      },
      output_format: spec.output_format,
    };

    const submitted = await this.json<Job>(await this.call("/sdcpp/v1/img_gen", { method: "POST", headers, body: JSON.stringify(body) }, signal), "il lavoro");
    if (!submitted.id) throw new ImageError("Il motore locale non ha restituito l'id del lavoro.", this.name, true);
    const pollPath = submitted.poll_url ?? `/sdcpp/v1/jobs/${submitted.id}`;

    const cancel = () => this.call(`/sdcpp/v1/jobs/${submitted.id}/cancel`, { method: "POST", headers }).catch(() => undefined);
    const deadline = started + (this.options.timeoutMs ?? 15 * 60_000);
    for (;;) {
      if (signal?.aborted) {
        await cancel();
        throw new ImageCancelledError(this.name);
      }
      if (Date.now() > deadline) {
        await cancel();
        throw new ImageError("Il motore locale non ha finito in tempo: la GPU è occupata da altro, o il modello non ci sta in memoria.", this.name, false);
      }
      let job: Job;
      try {
        job = await this.json<Job>(await this.call(pollPath, { method: "GET", headers: { accept: "application/json" } }, signal), "lo stato del lavoro");
      } catch (error) {
        if (error instanceof ImageCancelledError) {
          await cancel();
        }
        throw error;
      }
      if (job.status === "completed") {
        const image = job.result?.images?.[0]?.b64_json;
        if (!image) throw new ImageError("Il motore locale ha finito senza restituire un'immagine.", this.name, true);
        return {
          data: fromBase64(image.replace(/^data:[^,]*,/, "")),
          mediaType: `image/${job.result?.output_format ?? "png"}`,
          meta: { model: this.model, durationMs: Date.now() - started, costUsd: 0, remoteId: submitted.id },
        };
      }
      if (job.status === "failed") throw new ImageError(`Il motore locale non è riuscito a generare: ${job.error?.message ?? job.error?.code ?? "errore sconosciuto"}.`, this.name, false);
      if (job.status === "cancelled") throw new ImageCancelledError(this.name);
      await sleep(this.options.pollMs ?? 500);
    }
  }
}
