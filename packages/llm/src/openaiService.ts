import { LlmError, LlmTruncatedError, type LlmService, type LlmRequest, type LlmResponse } from "./service.js";

export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiOptions {
  apiKey: string;
  /** `gpt-6-astra` (predefinito), oppure `gpt-6.1-sol` e `gpt-6-luna` per spendere meno. */
  model?: string;
  /** Anche per i servizi compatibili con la Responses API, o per un proxy. */
  baseUrl?: string;
  /**
   * Il limite comprende i token di ragionamento, non solo la risposta: tenerlo
   * stretto tronca lo spoglio prima ancora che il modello cominci a scriverlo.
   */
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ResponsesPayload {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string } | null;
}

/**
 * Adapter per l'API di OpenAI (Responses API).
 *
 * Parla lo stesso HTTP nudo di DeepSeek, ma sta dall'altra parte della
 * differenza che lì conta: qui lo schema si passa come parametro e il fornitore
 * vincola la risposta (structured output in modalità `strict`). Per questo
 * `constraint` dichiara `schema`, come Anthropic — e come per Anthropic a valle
 * si valida comunque.
 */
export class OpenAiLlmService implements LlmService {
  readonly name = "openai";
  readonly constraint = "schema" as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiOptions) {
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
    this.model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
    this.maxTokens = options.maxTokens ?? 32000;

    if (options.fetchImpl) {
      this.fetchImpl = options.fetchImpl;
    } else if (globalThis.fetch) {
      // Stesso baco già trovato con Ollama: senza `.bind`, nel browser `fetch`
      // invocato come metodo di quest'oggetto risponde "Illegal invocation".
      this.fetchImpl = globalThis.fetch.bind(globalThis);
    } else {
      throw new LlmError("Nessuna implementazione di fetch disponibile", this.name);
    }
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 300_000);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          // Il copione è inedito: che almeno non resti archiviato dal fornitore
          // fra le risposte consultabili.
          store: false,
          instructions: request.system,
          input: request.user,
          max_output_tokens: this.maxTokens,
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              strict: true,
              schema: strictSchema(request.schema),
            },
          },
          // `temperature` non viene passata di proposito: i modelli che
          // ragionano la rifiutano, e il modello qui è configurabile.
        }),
      });
    } catch (cause) {
      throw new LlmError(`OpenAI non raggiungibile su ${this.baseUrl}: controlla la connessione.`, this.name, cause);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LlmError(describeStatus(response.status, body), this.name);
    }

    const payload = (await response.json()) as ResponsesPayload;

    if (payload.status === "incomplete") {
      if (payload.incomplete_details?.reason === "max_output_tokens") {
        throw new LlmTruncatedError(
          `Risposta troncata a ${this.maxTokens} token: il capitolo è troppo lungo per una sola richiesta. Spezzalo, o alza il limite.`,
          this.name,
        );
      }
      throw new LlmError(
        `OpenAI ha interrotto la risposta${
          payload.incomplete_details?.reason ? ` (${payload.incomplete_details.reason})` : ""
        }. Se il capitolo contiene materiale che fa scattare un filtro, prova lo spoglio locale con Ollama.`,
        this.name,
      );
    }

    // La risposta è una lista di elementi (ragionamento, messaggio…): il testo
    // sta nelle parti `output_text` dei messaggi, il rifiuto in una parte a sé.
    const parts = (payload.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);

    const refusal = parts.find((part) => part.type === "refusal");
    if (refusal) {
      throw new LlmError(
        `Il modello ha rifiutato la richiesta${
          refusal.refusal ? `: ${refusal.refusal}` : ""
        }. Se il capitolo contiene materiale che fa scattare un filtro, prova lo spoglio locale con Ollama.`,
        this.name,
      );
    }

    const content = parts
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!content) {
      throw new LlmError(
        payload.error?.message
          ? `OpenAI ha risposto con un errore: ${payload.error.message}`
          : "OpenAI ha restituito una risposta vuota: riprova.",
        this.name,
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (cause) {
      throw new LlmError("OpenAI ha risposto con JSON non valido, nonostante lo schema.", this.name, cause);
    }

    return {
      data,
      meta: { model: payload.model ?? this.model, durationMs: Date.now() - started },
    };
  }
}

/**
 * La modalità `strict` accetta un sottoinsieme di JSON Schema e risponde con un
 * errore a ciò che non conosce. Lo schema dello spoglio ci sta già dentro (tutti
 * i campi obbligatori, `additionalProperties: false`); l'unica cosa in più è
 * l'intestazione `$schema` che la derivazione dallo zod aggiunge.
 */
function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...schema };
  delete rest.$schema;
  return rest;
}

/** Codici documentati dal fornitore, tradotti in cosa fare. */
function describeStatus(status: number, body: string): string {
  const detail = errorMessage(body);
  switch (status) {
    case 400:
      return `Richiesta non accettata da OpenAI: ${detail}`;
    case 401:
      return "Chiave API di OpenAI rifiutata: verificala o creane una nuova.";
    case 403:
      return "La chiave non ha accesso a questo modello, o OpenAI non è disponibile dal tuo paese.";
    case 404:
      return "Modello inesistente, o non accessibile con questa chiave: controlla il nome.";
    case 429:
      // Lo stesso codice per due situazioni con rimedi opposti: aspettare, o pagare.
      return body.includes("insufficient_quota")
        ? "Credito OpenAI esaurito: controlla piano e fatturazione."
        : "Troppe richieste a OpenAI in poco tempo: riprova fra poco.";
    case 500:
    case 503:
      return "OpenAI è sovraccarico o ha un problema temporaneo: riprova fra poco.";
    default:
      return `OpenAI ha risposto ${status}: ${detail}`;
  }
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message.slice(0, 300);
  } catch {
    // Corpo non JSON: si riporta com'è.
  }
  return body.slice(0, 200);
}
