import { LlmError, type LlmService, type LlmRequest, type LlmResponse } from "./service.js";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

export interface DeepSeekOptions {
  apiKey: string;
  /** `deepseek-flash` (predefinito) o `deepseek-v4-pro`. I vecchi nomi vengono reindirizzati dal fornitore. */
  model?: string;
  baseUrl?: string;
  /**
   * Il JSON mode può troncare la risposta a metà se il limite è basso, e uno
   * spoglio di un capitolo intero non è corto: meglio abbondare.
   */
  maxTokens?: number;
  /** Bassa di proposito, come per Ollama: lo spoglio estrae, non inventa. */
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
}

/**
 * Adapter per l'API di DeepSeek (formato OpenAI).
 *
 * Il punto che distingue questo fornitore dagli altri due, e che va tenuto
 * presente leggendo i risultati: il suo JSON mode garantisce **JSON valido, non
 * lo schema**. Ollama costruisce una grammatica, Anthropic vincola con gli
 * structured output; qui il modello riceve la forma solo come testo. Per questo
 * `constraint` dichiara `json` — ed è il caso in cui validazione e riparazione a
 * valle non sono una rete di sicurezza teorica ma lavorano davvero.
 */
export class DeepSeekLlmService implements LlmService {
  readonly name = "deepseek";
  readonly constraint = "json" as const;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.model = options.model?.trim() || DEFAULT_DEEPSEEK_MODEL;

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

  /**
   * Il fornitore non accetta uno schema, quindi lo schema va *descritto*: la sua
   * documentazione chiede di nominare "json" nel prompt e di mostrare la forma
   * attesa. Lo si aggiunge qui e non nel prompt comune, perché gli altri
   * fornitori lo ricevono già per un canale più forte e non ne hanno bisogno.
   */
  private systemWithSchema(request: LlmRequest): string {
    return [
      request.system,
      "",
      "Rispondi con un unico oggetto JSON conforme a questo JSON Schema. Nessun testo prima o dopo, nessun blocco di codice:",
      JSON.stringify(request.schema),
    ].join("\n");
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 300_000);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          response_format: { type: "json_object" },
          max_tokens: this.options.maxTokens ?? 8192,
          temperature: this.options.temperature ?? 0.2,
          messages: [
            { role: "system", content: this.systemWithSchema(request) },
            { role: "user", content: request.user },
          ],
        }),
      });
    } catch (cause) {
      throw new LlmError(`DeepSeek non raggiungibile su ${this.baseUrl}: controlla la connessione.`, this.name, cause);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LlmError(describeStatus(response.status, body), this.name);
    }

    const payload = (await response.json()) as ChatCompletion;
    const choice = payload.choices?.[0];

    if (choice?.finish_reason === "length") {
      throw new LlmError(
        "Risposta troncata: il capitolo produce più testo del limite impostato. Spezzalo, o alza il limite di token.",
        this.name,
      );
    }

    const content = choice?.message?.content?.trim();
    if (!content) {
      // Caso documentato dal fornitore ("may occasionally return empty
      // content"): non è un nostro errore, e riprovare di solito basta.
      throw new LlmError("DeepSeek ha restituito una risposta vuota. È un comportamento noto del JSON mode: riprova.", this.name);
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (cause) {
      throw new LlmError("DeepSeek ha risposto con JSON non valido, nonostante il JSON mode.", this.name, cause);
    }

    return {
      data,
      meta: { model: payload.model ?? this.model, durationMs: Date.now() - started },
    };
  }
}

/** Codici documentati dal fornitore, tradotti in cosa fare. */
function describeStatus(status: number, body: string): string {
  switch (status) {
    case 401:
      return "Chiave API di DeepSeek rifiutata: verificala o creane una nuova.";
    case 402:
      return "Credito DeepSeek esaurito: ricarica il conto per continuare.";
    case 422:
      return `Parametri non accettati da DeepSeek: ${body.slice(0, 200)}`;
    case 429:
      return "Troppe richieste a DeepSeek in poco tempo: riprova fra poco.";
    case 500:
    case 503:
      return "DeepSeek è sovraccarico o ha un problema temporaneo: riprova fra poco.";
    default:
      return `DeepSeek ha risposto ${status}: ${body.slice(0, 200)}`;
  }
}
