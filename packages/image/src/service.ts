import type { RenderSpec } from "@comic-builder/core";

/**
 * Interfaccia del servizio di immagini (§11.1).
 *
 * Riceve uno `RenderSpec` già compilato e i byte dei riferimenti che lo spec
 * nomina, e restituisce i byte di un'immagine. Non sa niente di documento,
 * cartelle o cache: quelli sono di chi chiama. Come `LlmService`, esiste
 * perché dev'essere mockabile per i test e sostituibile quando cambia il
 * fornitore — e non è mai cablata nella UI.
 */
export interface ReferenceImage {
  path: string;
  data: Uint8Array;
  mediaType: string;
}

export interface ImageRequest {
  spec: RenderSpec;
  /** Nello stesso ordine di `spec.references`: il prompt le chiama per numero. */
  references: readonly ReferenceImage[];
  signal?: AbortSignal;
}

export interface ImageResult {
  data: Uint8Array;
  mediaType: string;
  meta: {
    model: string;
    durationMs: number;
    /** Quanto ha addebitato il fornitore, se lo dice: il consuntivo, non la stima. */
    costUsd: number | null;
    remoteId?: string;
  };
}

export interface ImageEstimate {
  usd: number;
  seconds: number;
}

export interface ImageService {
  readonly name: string;
  readonly model: string;
  readonly maxReferences: number;
  /** Stima preventiva (§9.3): prima di spendere si sa quanto, anche se all'incirca. */
  estimate(spec: RenderSpec): ImageEstimate;
  generate(request: ImageRequest): Promise<ImageResult>;
}

export class ImageError extends Error {
  constructor(
    message: string,
    readonly service: string,
    /** Vero se riprovare ha senso (sovraccarico, rete); falso se la richiesta è sbagliata o rifiutata. */
    readonly retryable = false,
    readonly cause?: unknown,
    /** Quanto aspettare prima di riprovare, se il fornitore lo dice (limite di richieste al minuto). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ImageError";
  }
}

/** L'utente ha fermato la coda: non è un errore da mostrare. */
export class ImageCancelledError extends ImageError {
  constructor(service: string) {
    super("Generazione annullata.", service);
    this.name = "ImageCancelledError";
  }
}

/** Quanto può durare una singola chiamata HTTP, risposta compresa: il limite del lavoro intero è un'altra cosa. */
export const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Il segnale di una chiamata: quello di chi chiama più un tempo massimo.
 * Una connessione appesa non deve tenere ferma la coda per sempre.
 */
export function requestSignal(signal: AbortSignal | undefined, timeoutMs = REQUEST_TIMEOUT_MS): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timedOut: () => timeout.aborted && !signal?.aborted };
}

/**
 * Un errore arrivato dopo che il fornitore ha accettato il lavoro.
 *
 * La coda, se riprova, rimanda il lavoro da capo: dal fornitore cloud è una
 * seconda immagine pagata, sulla GPU un secondo lavoro accanto al primo. Da
 * qui in poi i tentativi li fa il servizio, sullo stesso lavoro; alla coda
 * arriva un errore che non si riprova.
 */
export function settled(error: unknown): unknown {
  if (!(error instanceof ImageError) || error instanceof ImageCancelledError || !error.retryable) return error;
  return new ImageError(error.message, error.service, false, error.cause);
}

/** Quante volte di fila si riprova a interrogare o a scaricare lo stesso lavoro prima di arrendersi. */
export const FOLLOW_UP_TRIES = 5;

/**
 * Interroga o scarica il lavoro già accettato, sopportando qualche guasto
 * passeggero (rete, 5xx, coda piena) senza rimandarlo. Finiti i tentativi,
 * l'errore che esce non si riprova: vedi `settled`.
 */
export async function followUp<T>(
  attempt: () => Promise<T>,
  options: { signal?: AbortSignal | undefined; sleep: (ms: number) => Promise<void>; delayMs?: number; tries?: number },
): Promise<T> {
  const tries = options.tries ?? FOLLOW_UP_TRIES;
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const passing = error instanceof ImageError && error.retryable && !(error instanceof ImageCancelledError);
      if (!passing || n >= tries || options.signal?.aborted) throw settled(error);
      await options.sleep(error.retryAfterMs ?? (options.delayMs ?? 1000) * n);
    }
  }
}

/** Legge il corpo di una risposta: anche lì una connessione può cadere o scadere. */
export async function readBody<T>(read: () => Promise<T>, service: string, signal?: AbortSignal): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof ImageError) throw cause;
    if (signal?.aborted) throw new ImageCancelledError(service);
    throw new ImageError("La risposta si è interrotta a metà.", service, true, cause);
  }
}
