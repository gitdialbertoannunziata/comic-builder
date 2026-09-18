import { LlmError, type LlmService, type LlmRequest, type LlmResponse } from "./service.js";

export interface OllamaOptions {
  /** Modello già scaricato in Ollama (`ollama pull ...`). */
  model: string;
  /** Default: l'istanza locale. Niente chiave, niente account: gira sulla macchina dell'autore. */
  host?: string;
  /**
   * Bassa di proposito: lo spoglio è un compito di estrazione, non di
   * invenzione. La creatività la mette lo sceneggiatore nello script.
   */
  temperature?: number;
  timeoutMs?: number;
  /** Iniettabile per i test: si verifica il protocollo senza un modello acceso. */
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  error?: string;
}

/**
 * Adapter per Ollama.
 *
 * Primo fornitore reale per una ragione precisa: il copione inedito non esce
 * dalla macchina dell'autore. Il target di §2 lavora su una serie non ancora
 * pubblicata, e mandarne il testo a terzi è una scelta che va fatta apposta,
 * non per default.
 *
 * Vincola l'output con una grammatica (llama.cpp costruisce la grammatica dal
 * JSON Schema passato in `format`): il modello *non può* emettere qualcosa che
 * non sia conforme. È una garanzia più forte del "JSON mode" di molte API —
 * ma riguarda la forma, non il contenuto, e infatti a valle si valida comunque.
 */
export class OllamaLlmService implements LlmService {
  readonly name = "ollama";
  readonly constraint = "grammar" as const;

  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.host = (options.host ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    if (options.fetchImpl) {
      this.fetchImpl = options.fetchImpl;
    } else if (globalThis.fetch) {
      // `.bind` non è pignoleria: nel browser `fetch` vuole `window` come
      // ricevente, e chiamarlo come metodo di quest'oggetto fa scattare
      // "Illegal invocation". In Node non succede, quindi il baco è invisibile
      // ai test e compare solo a pagina aperta — dove per giunta sembrava un
      // problema di rete, perché il catch qui sotto lo inghiottiva.
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
      response = await this.fetchImpl(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: request.schema,
          options: { temperature: this.options.temperature ?? 0.2 },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
    } catch (cause) {
      // `fetch` fallisce allo stesso modo per due cause molto diverse: il
      // server non c'è, oppure c'è ma il browser ha bloccato la richiesta per
      // CORS. Distinguerle dal codice non si può — la specifica nasconde
      // apposta i dettagli della risposta bloccata — quindi si nominano
      // entrambe, invece di far cercare nel posto sbagliato.
      throw new LlmError(
        `Ollama non raggiungibile su ${this.host}. Due possibilità: non è in esecuzione (\`ollama serve\`), ` +
          `oppure è attivo ma rifiuta la richiesta di questa pagina — in quel caso riavvialo con \`OLLAMA_ORIGINS=*\`.`,
        this.name,
        cause,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LlmError(`Ollama ha risposto ${response.status}: ${body.slice(0, 300)}`, this.name);
    }

    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.error) throw new LlmError(`Ollama: ${payload.error}`, this.name);

    const content = payload.message?.content;
    if (!content) throw new LlmError("Ollama ha risposto senza contenuto", this.name);

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (cause) {
      // Non dovrebbe succedere con la grammatica attiva: se succede, è un
      // segnale che il modello non la supporta, e va detto invece che nascosto.
      throw new LlmError(
        `Ollama ha risposto con JSON non valido: il modello "${this.options.model}" potrebbe non supportare l'output vincolato`,
        this.name,
        cause,
      );
    }

    return {
      data,
      meta: { model: payload.model ?? this.options.model, durationMs: Date.now() - started },
    };
  }
}
