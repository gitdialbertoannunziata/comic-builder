import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { LlmError, LlmTruncatedError, type LlmService, type LlmRequest, type LlmResponse } from "./service.js";

/**
 * Modello di riferimento. Si cambia dalla configurazione: l'interfaccia esiste
 * proprio perché "sostituibile quando cambiano i fornitori o i modelli" (§11.1).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /**
   * Consente di usare l'SDK direttamente da una pagina web. **La chiave finisce
   * nel browser**, quindi chiunque apra quella pagina può leggerla: accettabile
   * per uno strumento locale a utente singolo con la propria chiave, non per
   * qualcosa di esposto. Un domani, impacchettato come applicazione desktop
   * (§14.4), la chiave starà nell'archivio sicuro dell'host via PlatformService.
   */
  allowBrowser?: boolean;
  /** Iniettabile per i test: si verifica l'adapter senza chiamare l'API. */
  client?: Anthropic;
}

/**
 * Adapter per l'API di Anthropic.
 *
 * Rispetto a Ollama lo scambio è opposto e va scelto sapendolo: qui il copione
 * inedito esce verso terzi, in cambio di un modello molto più capace. Per il
 * gate di F1 ("lo spoglio richiede meno correzioni di quante ne servirebbero a
 * mano", §12.2) è il termine di paragone alto — se non lo batte nemmeno questo,
 * il problema non è il modello ma il contratto che gli diamo.
 */
export class AnthropicLlmService implements LlmService {
  readonly name = "anthropic";
  /**
   * Gli structured output vincolano il formato della risposta, ma restano una
   * garanzia del fornitore e non una grammatica che rende impossibile uscirne:
   * per questo `schema` e non `grammar`. La differenza è dichiarata invece che
   * dedotta, ed è il motivo per cui a valle si valida comunque.
   */
  readonly constraint = "schema" as const;

  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicOptions) {
    this.model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
    this.maxTokens = options.maxTokens ?? 16000;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        ...(options.allowBrowser ? { dangerouslyAllowBrowser: true } : {}),
      });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();

    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        // Lo schema arriva già come JSON Schema, derivato dallo zod a monte:
        // usare l'helper JSON Schema invece di quello zod evita di legare il
        // pacchetto alla versione di zod che l'SDK si aspetta, e mantiene una
        // sola definizione dello schema per tutti i fornitori.
        // Il cast è il prezzo dell'interfaccia generica (`Record<string, unknown>`):
        // la forma la conosciamo, la produciamo noi.
        output_config: {
          format: jsonSchemaOutputFormat(request.schema as Parameters<typeof jsonSchemaOutputFormat>[0]),
        },
        // `thinking` non viene passato di proposito. Il modello è
        // configurabile dall'utente, e i modelli attuali hanno regole diverse:
        // omettendolo, Opus 5 usa comunque il ragionamento adattivo, mentre un
        // modello che non lo accetta non riceve un parametro che rifiuterebbe.
      });

      if (response.stop_reason === "refusal") {
        throw new LlmError(
          `Il modello ha rifiutato la richiesta${
            response.stop_details?.category ? ` (${response.stop_details.category})` : ""
          }. Se il capitolo contiene materiale che fa scattare un filtro, prova lo spoglio locale con Ollama.`,
          this.name,
        );
      }

      if (response.stop_reason === "max_tokens") {
        throw new LlmTruncatedError(
          `Risposta troncata a ${this.maxTokens} token: il capitolo è troppo lungo per una sola richiesta. Spezzalo, o alza il limite.`,
          this.name,
        );
      }

      // `parsed_output` è null se l'interpretazione fallisce: va controllato,
      // non dato per buono.
      if (response.parsed_output === null || response.parsed_output === undefined) {
        throw new LlmError("La risposta non è stata interpretata secondo lo schema richiesto.", this.name);
      }

      return {
        data: response.parsed_output,
        meta: { model: response.model, durationMs: Date.now() - started },
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      throw new LlmError(describe(error), this.name, error);
    }
  }
}

/** Messaggi che dicono cosa fare, invece di riportare lo stato HTTP e basta. */
function describe(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Chiave API rifiutata: controlla che sia valida e che non sia scaduta.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "La chiave non ha accesso a questo modello.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "Modello inesistente: controlla il nome.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Limite di frequenza raggiunto: riprova fra poco.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Impossibile raggiungere l'API. Dal browser può essere anche il blocco CORS, non solo la rete.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Errore dell'API${error.status ? ` (${error.status})` : ""}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
