import { LlmError, LlmTruncatedError, type LlmService, type LlmRequest, type LlmResponse } from "./service.js";

/**
 * Adapter per `llama-server` di llama.cpp: il modello linguistico in locale
 * che l'app desktop scarica e avvia da sé, come fa con il motore delle
 * immagini (stable-diffusion.cpp). Una sola strategia per tutto ciò che gira
 * sul computer di chi disegna: binari ufficiali, modelli GGUF con licenza
 * aperta, processi avviati e fermati dall'app.
 *
 * Si parla l'API compatibile con OpenAI (`/v1/chat/completions`). Lo schema
 * va in `response_format`, e llama-server lo trasforma in una grammatica: il
 * modello *non può* scrivere fuori dallo schema (`constraint: "grammar"`),
 * che per un modello piccolo vale più di qualunque istruzione.
 *
 * La risposta si chiede in streaming. Non per mostrarla: per averla. Uno
 * spoglio su una GPU piccola, o sulla CPU, chiede più di cinque minuti, e la
 * `fetch` di Node — quella del processo principale dell'app desktop —
 * abbandona una richiesta i cui header non arrivano entro cinque minuti.
 * In streaming gli header arrivano subito, e i token man mano.
 */
export interface LlamaServerOptions {
  /** Dove ascolta llama-server: di norma `http://127.0.0.1:<porta>`, scelta dall'app. */
  baseUrl?: string;
  /** Nell'app desktop l'indirizzo si conosce solo avviando il motore: lo si chiede qui, alla prima richiesta. */
  resolveBaseUrl?: () => Promise<string>;
  /** Il nome del modello, per l'esito: llama-server ne serve uno solo e ignora quello chiesto. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Un pezzo dello stream (`data: {…}`): il testo arriva a frammenti in `delta.content`. */
interface ChatChunk {
  model?: string;
  choices?: Array<{ finish_reason?: string | null; delta?: { content?: string | null } }>;
  error?: { message?: string } | null;
}

interface Streamed {
  content: string;
  finish: string | null;
  model: string | null;
  error: string | null;
}

/** Legge uno stream SSE e restituisce il testo intero, il motivo di fine e il modello. */
export async function readChatStream(body: ReadableStream<Uint8Array>): Promise<Streamed> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const out: Streamed = { content: "", finish: null, model: null, error: null };
  let buffer = "";
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as ChatChunk;
    if (chunk.error?.message) out.error = chunk.error.message;
    out.model ??= chunk.model ?? null;
    for (const choice of chunk.choices ?? []) {
      out.content += choice.delta?.content ?? "";
      if (choice.finish_reason) out.finish = choice.finish_reason;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");
    lines.forEach(take);
    if (done) break;
  }
  return out;
}

export class LlamaServerLlmService implements LlmService {
  readonly name = "locale";
  readonly constraint = "grammar" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LlamaServerOptions = {}) {
    if (!options.baseUrl && !options.resolveBaseUrl) throw new LlmError("Manca l'indirizzo del modello locale.", this.name);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const base = (this.options.baseUrl ?? (await this.options.resolveBaseUrl!())).replace(/\/$/, "");
    const controller = new AbortController();
    // Un modello locale su una GPU piccola, o sulla CPU, ci mette minuti a scrivere uno spoglio.
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20 * 60_000);

    let response: Response;
    try {
      response = await this.fetchImpl(`${base}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
          chat_template_kwargs: { enable_thinking: false },
          temperature: this.options.temperature ?? 0.2,
          max_tokens: this.options.maxTokens ?? 16000,
          stream: true,
        }),
      });
    } catch (cause) {
      clearTimeout(timeout);
      throw new LlmError(`Il modello locale non risponde su ${base}: è avviato?`, this.name, cause);
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      const body = await response.text().catch(() => "");
      throw new LlmError(`Il modello locale ha rifiutato la richiesta (HTTP ${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`, this.name);
    }

    let stream: Streamed;
    try {
      stream = await readChatStream(response.body);
    } catch (cause) {
      if (controller.signal.aborted) throw new LlmError("Il modello locale non ha finito in tempo: prova un capitolo più corto, o un modello più piccolo.", this.name, cause);
      throw new LlmError("Il modello locale ha interrotto la risposta a metà.", this.name, cause);
    } finally {
      clearTimeout(timeout);
    }
    if (stream.finish === "length") {
      throw new LlmTruncatedError("Risposta troncata dal limite di token del modello locale: il capitolo va diviso in parti più corte.", this.name);
    }
    const content = stream.content;
    if (!content.trim()) throw new LlmError(`Il modello locale non ha restituito una risposta${stream.error ? `: ${stream.error}` : ""}.`, this.name);

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (cause) {
      throw new LlmError("La risposta del modello locale non è JSON: la grammatica non è stata applicata.", this.name, cause);
    }
    return { data, meta: { model: this.options.model ?? stream.model ?? "locale", durationMs: Date.now() - started } };
  }
}
