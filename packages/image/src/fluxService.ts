import { FLUX2_MAX_REFERENCES, FLUX2_PRO, type RenderSpec } from "@comic-builder/core";
import { ImageCancelledError, ImageError, type ImageEstimate, type ImageRequest, type ImageResult, type ImageService } from "./service.js";

/**
 * `ImageService` su FLUX.2 [pro] via l'API di Black Forest Labs (F3).
 *
 * L'API è asincrona: la richiesta restituisce un `polling_url`, che si
 * interroga finché l'immagine è pronta; il risultato è un URL firmato che
 * scade dopo dieci minuti, quindi si scarica subito e a chi chiama arrivano
 * i byte. Né l'API né gli URL di consegna abilitano CORS: da un browser ci
 * si arriva solo attraverso un proxy, e `rewriteUrl` è il punto in cui
 * l'host lo dichiara.
 *
 * Il modello non ha prompt negativo, sampler o LoRA: la coerenza dei
 * personaggi passa dalle immagini di riferimento (fino a otto), che lo spec
 * elenca nell'ordine in cui il prompt le nomina.
 */
export interface FluxOptions {
  apiKey: string;
  model?: string;
  /** `https://api.bfl.ai` (globale), oppure `api.eu.bfl.ai` / `api.us.bfl.ai` per restare in una regione. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Trasforma ogni URL prima della chiamata: serve all'host che deve passare da un proxy. */
  rewriteUrl?: (url: string) => string;
  /** 0 (più severo) … 5. */
  safetyTolerance?: number;
  pollMs?: number;
  /** Oltre questo tempo senza risultato la richiesta si considera persa. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Submitted {
  id?: string;
  polling_url?: string;
  /** In crediti: 1 credito = 0,01 USD. */
  cost?: number | null;
}

interface Polled {
  status?: string;
  result?: { sample?: string } | null;
  details?: unknown;
}

const USD_PER_CREDIT = 0.01;
const MEGAPIXEL = 1024 * 1024;

/**
 * Stima della spesa di FLUX.2 [pro]: 0,03 USD il primo megapixel generato,
 * 0,015 per ogni megapixel in più, in uscita o in ingresso. Le dimensioni dei
 * riferimenti qui non si conoscono: se ne conta uno a testa. È una stima —
 * il listino cambia, e il consuntivo vero è il `cost` che l'API restituisce.
 */
export function estimateFluxUsd(spec: Pick<RenderSpec, "width" | "height" | "references">): number {
  const outputMp = Math.max(1, Math.ceil((spec.width * spec.height) / MEGAPIXEL));
  return 0.03 + 0.015 * (outputMp - 1 + spec.references.length);
}

/** Il corpo della richiesta di FLUX.2: lo stesso per l'API di Black Forest Labs e per quella di Azure. */
function fluxBody(request: ImageRequest, safetyTolerance: number | undefined): Record<string, unknown> {
  const { spec, references } = request;
  const body: Record<string, unknown> = {
    prompt: spec.prompt,
    seed: spec.seed,
    width: spec.width,
    height: spec.height,
    output_format: spec.output_format,
    safety_tolerance: safetyTolerance ?? 2,
    // Il fornitore riscrive il prompt, se non glielo si vieta: lo spec
    // registrato non sarebbe più quello che ha prodotto l'immagine.
    disable_pup: !spec.prompt_upsampling,
  };
  references.forEach((reference, i) => {
    body[i === 0 ? "input_image" : `input_image_${i + 1}`] = toBase64(reference.data);
  });
  return body;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class FluxImageService implements ImageService {
  readonly name = "flux";
  readonly maxReferences = FLUX2_MAX_REFERENCES;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: FluxOptions) {
    if (!options.apiKey.trim()) throw new ImageError("Manca la chiave API di Black Forest Labs.", "flux");
    this.model = options.model ?? FLUX2_PRO;
    this.baseUrl = (options.baseUrl ?? "https://api.bfl.ai").replace(/\/$/, "");
  }

  estimate(spec: RenderSpec): ImageEstimate {
    return { usd: estimateFluxUsd(spec), seconds: 12 + 3 * spec.references.length };
  }

  private async call(url: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const target = this.options.rewriteUrl ? this.options.rewriteUrl(url) : url;
    try {
      return await fetchImpl(target, { ...init, ...(signal ? { signal } : {}) });
    } catch (cause) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      throw new ImageError("Black Forest Labs non raggiungibile: controlla la connessione.", this.name, true, cause);
    }
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const { spec, references, signal } = request;
    if (references.length > this.maxReferences) {
      throw new ImageError(`FLUX.2 accetta al massimo ${this.maxReferences} immagini di riferimento: ne sono arrivate ${references.length}.`, this.name);
    }
    const started = Date.now();
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const headers = { "x-key": this.options.apiKey, accept: "application/json" };

    const body = fluxBody(request, this.options.safetyTolerance);

    const submitted = await this.call(
      `${this.baseUrl}/v1/${spec.model}`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      signal,
    );
    if (!submitted.ok) throw describeStatus(submitted.status, await submitted.text().catch(() => ""), this.name);
    const task = (await submitted.json()) as Submitted;
    if (!task.polling_url) throw new ImageError("Black Forest Labs ha accettato la richiesta senza dire dove seguirla.", this.name);

    const deadline = started + (this.options.timeoutMs ?? 180_000);
    for (;;) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      await sleep(this.options.pollMs ?? 1000);
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      const response = await this.call(task.polling_url, { method: "GET", headers }, signal);
      if (!response.ok) throw describeStatus(response.status, await response.text().catch(() => ""), this.name);
      const polled = (await response.json()) as Polled;

      if (polled.status === "Ready") {
        const sample = polled.result?.sample;
        if (!sample) throw new ImageError("Black Forest Labs dice che l'immagine è pronta, ma non dà l'indirizzo.", this.name, true);
        // Senza chiave: l'URL è firmato, e la chiave non va mandata all'host di consegna.
        const image = await this.call(sample, { method: "GET" }, signal);
        if (!image.ok) throw new ImageError(`Download dell'immagine fallito (${image.status}).`, this.name, true);
        return {
          data: new Uint8Array(await image.arrayBuffer()),
          mediaType: `image/${spec.output_format}`,
          meta: {
            model: spec.model,
            durationMs: Date.now() - started,
            costUsd: typeof task.cost === "number" ? task.cost * USD_PER_CREDIT : null,
            ...(task.id ? { remoteId: task.id } : {}),
          },
        };
      }
      if (polled.status === "Request Moderated" || polled.status === "Content Moderated") {
        throw new ImageError(
          polled.status === "Request Moderated"
            ? "Il filtro di sicurezza ha rifiutato il prompt di questa vignetta: riformula l'azione, o usa un prompt tuo."
            : "Il filtro di sicurezza ha scartato l'immagine generata: riprova con un'altra variante.",
          this.name,
        );
      }
      if (polled.status === "Error" || polled.status === "Failed") {
        throw new ImageError(`Generazione fallita presso il fornitore${polled.details ? `: ${JSON.stringify(polled.details).slice(0, 200)}` : "."}`, this.name, true);
      }
      if (polled.status === "Task not found") throw new ImageError("Il fornitore non trova più la richiesta.", this.name, true);
      if (Date.now() > deadline) throw new ImageError("Nessun risultato entro il tempo limite: la richiesta è rimasta in coda dal fornitore.", this.name, true);
    }
  }
}

/** Codici documentati dal fornitore, tradotti in cosa fare. */
function describeStatus(status: number, body: string, service: string): ImageError {
  switch (status) {
    case 401:
    case 403:
      return new ImageError("Chiave API di Black Forest Labs rifiutata: verificala o creane una nuova.", service);
    case 402:
      return new ImageError("Credito Black Forest Labs esaurito: ricarica il conto per continuare.", service);
    case 422:
      return new ImageError(`Parametri non accettati da FLUX.2: ${body.slice(0, 300)}`, service);
    case 429:
      return new ImageError("Troppe richieste insieme a Black Forest Labs: riprovo fra poco.", service, true);
    default:
      return new ImageError(`Black Forest Labs ha risposto ${status}: ${body.slice(0, 200)}`, service, status >= 500);
  }
}

/**
 * FLUX.2 [pro] distribuito su Azure AI Foundry: stesso modello e stesso
 * corpo della richiesta, ma un'altra API attorno. La risposta è sincrona e
 * porta l'immagine in base64 — niente polling, niente URL da scaricare — e
 * il modello si nomina col nome del *deployment*, che l'utente sceglie.
 *
 * Il limite che conta qui è quello di richieste al minuto del deployment
 * (poche unità, al livello base): un 429 dice quanto aspettare, e la coda
 * aspetta quello invece di riprovare a vuoto.
 */
export interface AzureFluxOptions {
  apiKey: string;
  /** L'endpoint della risorsa; va bene anche quello del progetto (`…/api/projects/<nome>`), se ne usa l'origine. */
  endpoint: string;
  /** Nome del deployment in Foundry; di default quello proposto dal catalogo. */
  deployment?: string;
  fetchImpl?: typeof fetch;
  rewriteUrl?: (url: string) => string;
  safetyTolerance?: number;
}

interface AzureGenerated {
  data?: Array<{ b64_json?: string; url?: string }>;
  request_meta?: { cost?: number | null };
  error?: { message?: string; code?: string };
}

export const AZURE_FLUX_DEPLOYMENT = "FLUX.2-pro";

export class AzureFluxImageService implements ImageService {
  readonly name = "azure-flux";
  readonly maxReferences = FLUX2_MAX_REFERENCES;
  readonly model: string;
  private readonly origin: string;

  constructor(private readonly options: AzureFluxOptions) {
    if (!options.apiKey.trim()) throw new ImageError("Manca la chiave API della risorsa Azure AI Foundry.", "azure-flux");
    try {
      this.origin = new URL(options.endpoint.trim()).origin;
    } catch {
      throw new ImageError(`«${options.endpoint}» non è un endpoint valido: serve l'indirizzo della risorsa, es. https://nome.services.ai.azure.com`, "azure-flux");
    }
    this.model = options.deployment?.trim() || AZURE_FLUX_DEPLOYMENT;
  }

  estimate(spec: RenderSpec): ImageEstimate {
    return { usd: estimateFluxUsd(spec), seconds: 8 + 3 * spec.references.length };
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const { spec, references, signal } = request;
    if (references.length > this.maxReferences) {
      throw new ImageError(`FLUX.2 accetta al massimo ${this.maxReferences} immagini di riferimento: ne sono arrivate ${references.length}.`, this.name);
    }
    const started = Date.now();
    const url = `${this.origin}/providers/blackforestlabs/v1/flux-2-pro?api-version=preview`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(this.options.rewriteUrl ? this.options.rewriteUrl(url) : url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({ model: this.model, ...fluxBody(request, this.options.safetyTolerance) }),
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      throw new ImageError("Azure AI Foundry non raggiungibile: controlla la connessione e l'endpoint.", this.name, true, cause);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let detail = text.slice(0, 300);
      try {
        detail = (JSON.parse(text) as AzureGenerated).error?.message ?? detail;
      } catch {
        // Non era JSON: resta il testo.
      }
      switch (response.status) {
        case 401:
        case 403:
          throw new ImageError("Chiave rifiutata da Azure AI Foundry: verifica che sia quella della risorsa indicata nell'endpoint.", this.name);
        case 404:
          throw new ImageError(`Azure non trova il deployment «${this.model}»: controlla il nome in Foundry (Modelli + endpoint) e l'endpoint.`, this.name);
        case 429: {
          const seconds = Number(response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-requests"));
          return Promise.reject(
            new ImageError("Limite di richieste al minuto del deployment raggiunto: aspetto e riprovo.", this.name, true, undefined, (Number.isFinite(seconds) && seconds > 0 ? seconds : 20) * 1000),
          );
        }
        case 400:
        case 422:
          throw new ImageError(`Richiesta non accettata da FLUX.2: ${detail}`, this.name);
        default:
          throw new ImageError(`Azure AI Foundry ha risposto ${response.status}: ${detail}`, this.name, response.status >= 500);
      }
    }

    const payload = (await response.json()) as AzureGenerated;
    const image = payload.data?.[0];
    let data: Uint8Array;
    if (image?.b64_json) {
      data = Uint8Array.from(atob(image.b64_json), (c) => c.charCodeAt(0));
    } else if (image?.url) {
      const download = await fetchImpl(this.options.rewriteUrl ? this.options.rewriteUrl(image.url) : image.url, signal ? { signal } : {});
      if (!download.ok) throw new ImageError(`Download dell'immagine fallito (${download.status}).`, this.name, true);
      data = new Uint8Array(await download.arrayBuffer());
    } else {
      throw new ImageError("Azure ha risposto senza immagine: di solito è il filtro di sicurezza. Riformula l'azione della vignetta, o usa un prompt tuo.", this.name);
    }
    const cost = payload.request_meta?.cost;
    return {
      data,
      mediaType: `image/${spec.output_format}`,
      meta: { model: this.model, durationMs: Date.now() - started, costUsd: typeof cost === "number" ? cost * USD_PER_CREDIT : null },
    };
  }
}
