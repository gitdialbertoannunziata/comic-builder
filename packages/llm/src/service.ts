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
