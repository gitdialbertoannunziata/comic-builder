/**
 * Interfaccia del servizio linguistico (§11.1).
 *
 * Esiste per due motivi dichiarati dal piano: dev'essere **mockabile** per i
 * test offline e **sostituibile** quando cambiano fornitori o modelli. Non è
 * mai cablata nella UI.
 */

export interface LlmRequest {
  /** Istruzioni di sistema: il contratto che il modello deve rispettare. */
  system: string;
  /** Il testo da elaborare. */
  user: string;
  /** JSON Schema a cui l'output deve conformarsi (decoding vincolato, §12 F1). */
  schema: Record<string, unknown>;
  /** Nome dello schema: alcuni fornitori lo richiedono nella richiesta. */
  schemaName: string;
  /** Chi ferma il lavoro ferma anche la richiesta: un modello locale non scrive per nessuno. */
  signal?: AbortSignal;
}

export interface LlmResponse {
  /**
   * JSON già interpretato. L'implementazione garantisce solo che *sia* JSON:
   * che sia conforme allo schema lo stabilisce chi chiama, validando. Nessun
   * fornitore è abbastanza affidabile da saltare quel passo.
   */
  data: unknown;
  meta: {
    model: string;
    durationMs: number;
  };
}

/**
 * Quanto strettamente il fornitore vincola l'output. Dichiarato e non
 * indovinato: il ventaglio di modelli raggiungibili è ampio, quello che fa
 * davvero decoding vincolato molto meno — e la differenza va saputa prima,
 * non scoperta in produzione.
 *
 * - `grammar`: l'output *non può* uscire dallo schema (grammatica, llama.cpp)
 * - `schema`: il fornitore accetta uno schema e di norma lo rispetta
 * - `json`: garantisce JSON sintattico, non la forma
 * - `none`: testo libero, va estratto
 */
export type OutputConstraint = "grammar" | "schema" | "json" | "none";

export interface LlmService {
  readonly name: string;
  readonly constraint: OutputConstraint;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * La risposta è stata tagliata dal limite di token del fornitore. È un
 * errore a parte perché ha un rimedio che chi chiama può applicare da solo:
 * chiedere meno testo per volta (vedi lo spoglio a parti in `breakdown`).
 */
export class LlmTruncatedError extends LlmError {
  constructor(message: string, service: string) {
    super(message, service);
    this.name = "LlmTruncatedError";
  }
}

/** Chi ha chiesto ha fermato il lavoro: non è un errore da mostrare. */
export class LlmCancelledError extends LlmError {
  constructor(service: string) {
    super("Richiesta annullata.", service);
    this.name = "LlmCancelledError";
  }
}

/**
 * Il segnale di una richiesta: quello di chi chiama più il tempo massimo.
 * Il tempo vale fino all'ultimo byte della risposta, non solo fino agli
 * header: un fornitore che manda gli header e poi tace non tiene ferma la coda.
 */
export function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancelled: () => boolean; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cancelled: () => signal?.aborted === true,
    timedOut: () => timeout.aborted && signal?.aborted !== true,
  };
}

/**
 * Un guasto di rete o di lettura, detto per quello che è: annullato da chi
 * chiama, scaduto, o — solo se non è nessuno dei due — `otherwise`.
 */
export function networkFailure(cause: unknown, service: string, limited: ReturnType<typeof requestSignal>, otherwise: string): LlmError {
  if (cause instanceof LlmError) return cause;
  if (limited.cancelled()) return new LlmCancelledError(service);
  if (limited.timedOut()) return new LlmError(`Il modello (${service}) non ha finito entro il tempo massimo della richiesta: prova un capitolo più corto, o un modello più veloce.`, service, cause);
  return new LlmError(otherwise, service, cause);
}
