import { FLUX2_KLEIN_4B, maxReferencesFor, type RenderSpec } from "@comic-builder/core";
import {
  ImageCancelledError,
  ImageError,
  followUp,
  readBody,
  requestSignal,
  settled,
  type ImageEstimate,
  type ImageRequest,
  type ImageResult,
  type ImageService,
} from "./service.js";

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
  /** Il tempo massimo di una singola chiamata, risposta compresa. */
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Le ultime righe che il motore ha scritto. Servono a un guasto: il server
   * dice «generate_image returned no results», cioè *che* non è uscito niente,
   * e la ragione sta nel log del motore — che l'app ha, perché è l'app ad
   * averlo avviato e a raccoglierne l'uscita.
   */
  engineLog?: () => Promise<string> | string;
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

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** Una riga di solo avanzamento: barre, passi, «2.10s/it». Il campionamento le riscrive sulla stessa riga. */
const PROGRESS_ONLY = /^[\s|=>#.\\/()\-]*\d+(\s*\/\s*\d+)?[\s\-]*[\d.,]*\s*(s\/it|it\/s|ms\/it|%)?[\s\-]*$/;

/**
 * Le righe utili che il motore ha scritto: quelle che spiegano un guasto.
 *
 * L'avanzamento del campionamento torna sulla stessa riga con `\r` e ne fa una
 * riga sola, lunghissima: si spezza anche lì, si tolgono i colori e le righe che
 * sono solo avanzamento, e restano le ultime che dicono qualcosa.
 */
export function engineTrouble(log: string, lines = 4): string[] {
  return log
    .split(/[\r\n]+/)
    .map((line) => line.replace(ANSI, "").trim())
    .filter((line) => line.length > 0 && !PROGRESS_ONLY.test(line))
    .slice(-lines);
}

/** Il log non deve mai diventare il secondo errore. */
async function readLog(engineLog: () => Promise<string> | string): Promise<string> {
  try {
    return await engineLog();
  } catch {
    return "";
  }
}

/**
 * Il messaggio di un guasto con le ultime righe che il motore ha scritto.
 *
 * Il messaggio del motore da solo non è un messaggio per chi disegna:
 * «generate_image returned no results» dice che non è uscito niente e non
 * perché. Le sue ultime righe, invece, dicono di solito quale passo è caduto —
 * e sono nostre, perché è l'app ad aver avviato il motore e a raccoglierne
 * l'uscita. Senza log da leggere, il messaggio resta quello di prima.
 */
async function withEngineLog(message: string, engineLog: (() => Promise<string> | string) | undefined): Promise<string> {
  const written = engineLog ? engineTrouble(await readLog(engineLog)) : [];
  return written.length > 0 ? `${message} Il motore ha scritto: ${written.map((line) => `«${line}»`).join(" ")}` : message;
}

/** Un guasto del motore, spiegato: cosa ha detto, cosa ha scritto lui, e — quando è la memoria — il rimedio che l'app conosce. */
async function describeFailure(said: string, engineLog: (() => Promise<string> | string) | undefined): Promise<string> {
  const message = await withEngineLog(`Il motore locale non è riuscito a generare: ${said}.`, engineLog);
  return /out of memory|oom|failed to allocate|allocat/i.test(message)
    ? `${message} Il modello non ci sta nella memoria della GPU: in Progetto → Modelli locali… c'è la variante compatta, o si passa al servizio cloud per le immagini.`
    : message;
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
    const limited = requestSignal(signal, this.options.requestTimeoutMs);
    try {
      return await fetchImpl(this.options.rewriteUrl ? this.options.rewriteUrl(url) : url, { ...init, signal: limited.signal });
    } catch (cause) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      if (limited.timedOut()) throw new ImageError(`Il motore locale non ha risposto in tempo su ${this.resolved ?? this.baseUrl}.`, this.name, true, cause);
      // Non si riprova: se il motore non è avviato, cinque tentativi sono solo cinque attese.
      // Un motore spento a metà lavoro, però, ha scritto perché: le sue ultime righe vanno dette.
      throw new ImageError(await withEngineLog(`Il motore locale non risponde su ${this.resolved ?? this.baseUrl}: è avviato?`, this.options.engineLog), this.name, false, cause);
    }
  }

  private async json<T>(response: Response, what: string, signal?: AbortSignal): Promise<T> {
    if (response.status === 429) throw new ImageError("Il motore locale ha la coda piena: riprovo fra poco.", this.name, true, undefined, 2000);
    // Un proxy davanti al motore (il server di sviluppo) risponde 502 quando dietro non c'è nessuno.
    if (response.status === 502 || response.status === 504) throw new ImageError(`Il motore locale non risponde su ${this.resolved ?? this.baseUrl}: è avviato?`, this.name, false);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ImageError(`Il motore locale ha rifiutato ${what} (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`, this.name, response.status >= 500);
    }
    return readBody(() => response.json() as Promise<T>, this.name, signal);
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

    // Da qui il lavoro esiste sul motore: qualunque uscita che non sia
    // l'immagine lo annulla, o la GPU continua per nessuno.
    const jobId = submitted.id;
    let finished = false;
    try {
      const result = await this.follow(jobId, pollPath, started, sleep, signal);
      finished = true;
      return result;
    } catch (error) {
      throw settled(error);
    } finally {
      if (!finished) await this.call(`/sdcpp/v1/jobs/${jobId}/cancel`, { method: "POST", headers }).catch(() => undefined);
    }
  }

  /** Segue il lavoro inviato fino all'immagine. */
  private async follow(jobId: string, pollPath: string, started: number, sleep: (ms: number) => Promise<void>, signal: AbortSignal | undefined): Promise<ImageResult> {
    const deadline = started + (this.options.timeoutMs ?? 15 * 60_000);
    for (;;) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      if (Date.now() > deadline) {
        throw new ImageError(
          await withEngineLog("Il motore locale non ha finito in tempo: la GPU è occupata da altro, o il modello non ci sta in memoria.", this.options.engineLog),
          this.name,
          false,
        );
      }
      const job = await followUp(
        async () => this.json<Job>(await this.call(pollPath, { method: "GET", headers: { accept: "application/json" } }, signal), "lo stato del lavoro", signal),
        { signal, sleep },
      );
      if (job.status === "completed") {
        const image = job.result?.images?.[0]?.b64_json;
        if (!image) throw new ImageError("Il motore locale ha finito senza restituire un'immagine.", this.name, true);
        return {
          data: fromBase64(image.replace(/^data:[^,]*,/, "")),
          mediaType: `image/${job.result?.output_format ?? "png"}`,
          meta: { model: this.model, durationMs: Date.now() - started, costUsd: 0, remoteId: jobId },
        };
      }
      if (job.status === "failed") {
        // Il messaggio del motore dice che non è uscito niente, non perché: le
        // sue ultime righe sono l'unica cosa che lo spieghi.
        throw new ImageError(await describeFailure(job.error?.message ?? job.error?.code ?? "errore sconosciuto", this.options.engineLog), this.name, false);
      }
      if (job.status === "cancelled") throw new ImageCancelledError(this.name);
      await sleep(this.options.pollMs ?? 500);
    }
  }
}
