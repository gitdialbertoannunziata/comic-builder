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
