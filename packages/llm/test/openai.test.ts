import { describe, expect, it } from "vitest";
import { OpenAiLlmService } from "../src/openaiService.js";
import { breakdownJsonSchema, BREAKDOWN_SCHEMA_NAME } from "../src/breakdownSchema.js";
import { breakdownScript } from "../src/breakdown.js";
import { LlmTruncatedError } from "../src/service.js";

const BREAKDOWN = {
  scenes: [
    {
      title: "Il faro",
      location: "scogliera",
      time_of_day: "alba",
      characters: ["sara"], mood: "calm", lighting: "flat",
      beats: [
        { function: "establish", summary: "Il faro spento.", intense: false, lines: [], characters: null, mood: null, props: [], from_line: 1, to_line: 2 },
      ],
    },
  ],
};

function reply(text: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: "gpt-6-astra",
      status: "completed",
      output: [
        // Il ragionamento precede il messaggio: va saltato, non letto come risposta.
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text }] },
      ],
      ...extra,
    }),
  );
}

function capturing(response: Response) {
  const captured: { url?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {};
  const fetchImpl = ((url: string, init: RequestInit) => {
    captured.url = url;
    captured.body = JSON.parse(String(init.body)) as Record<string, unknown>;
    captured.headers = init.headers as Record<string, string>;
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  return { captured, fetchImpl };
}

function request() {
  return { system: "istruzioni", user: "capitolo", schema: breakdownJsonSchema(), schemaName: BREAKDOWN_SCHEMA_NAME };
}

describe("OpenAiLlmService — forma della richiesta", () => {
  it("chiama /responses con la chiave come Bearer, senza far archiviare il copione", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new OpenAiLlmService({ apiKey: "sk-test", fetchImpl }).complete(request());

    expect(captured.url).toBe("https://api.openai.com/v1/responses");
    expect(captured.headers?.Authorization).toBe("Bearer sk-test");
    expect(captured.body?.model).toBe("gpt-6-astra");
    expect(captured.body?.store).toBe(false);
    expect(captured.body?.instructions).toBe("istruzioni");
    expect(captured.body?.input).toBe("capitolo");
    // I modelli che ragionano la rifiutano.
    expect(captured.body).not.toHaveProperty("temperature");
  });

  it("passa lo schema come parametro, in modalità strict", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request());

    const format = (captured.body?.text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe(BREAKDOWN_SCHEMA_NAME);
    expect(format.strict).toBe(true);

    const schema = format.schema as Record<string, unknown>;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("scenes");
  });

  it("lo schema dello spoglio rispetta le regole della modalità strict", () => {
    // Ogni oggetto: tutti i campi obbligatori e nessun campo in più. Se un
    // domani lo schema guadagna un campo facoltativo, OpenAI lo rifiuta con un
    // 400 — meglio saperlo qui.
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(
          Object.keys(schema.properties as Record<string, unknown>).sort(),
        );
      }
      Object.values(schema).forEach(visit);
    };
    visit(breakdownJsonSchema());
  });

  it("dichiara di vincolare allo schema", () => {
    const { fetchImpl } = capturing(reply("{}"));
    expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).constraint).toBe("schema");
  });

  it("rispetta modello, indirizzo e limite configurati", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new OpenAiLlmService({
      apiKey: "k",
      model: "gpt-6-luna",
      baseUrl: "https://proxy.example/v1/",
      maxTokens: 9000,
      fetchImpl,
    }).complete(request());

    expect(captured.url).toBe("https://proxy.example/v1/responses");
    expect(captured.body?.model).toBe("gpt-6-luna");
    expect(captured.body?.max_output_tokens).toBe(9000);
  });

  it("un indirizzo lasciato vuoto vale quello di OpenAI", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new OpenAiLlmService({ apiKey: "k", baseUrl: "  ", fetchImpl }).complete(request());
    expect(captured.url).toBe("https://api.openai.com/v1/responses");
  });
});

describe("OpenAiLlmService — esiti da gestire", () => {
  it("restituisce l'oggetto interpretato, saltando il ragionamento", async () => {
    const { fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    const response = await new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request());
    expect(response.data).toEqual(BREAKDOWN);
    expect(response.meta.model).toBe("gpt-6-astra");
  });

  it("segnala il troncamento come tale, perché lo spoglio possa ripiegare sulle parti", async () => {
    const { fetchImpl } = capturing(
      reply('{"scenes": [', { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    );
    await expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toBeInstanceOf(
      LlmTruncatedError,
    );
  });

  it("segnala il filtro dei contenuti", async () => {
    const { fetchImpl } = capturing(
      reply("", { status: "incomplete", incomplete_details: { reason: "content_filter" } }),
    );
    await expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(
      /content_filter/,
    );
  });

  it("segnala il rifiuto del modello con il suo motivo", async () => {
    const { fetchImpl } = capturing(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [{ type: "message", content: [{ type: "refusal", refusal: "Non posso aiutarti." }] }],
        }),
      ),
    );
    await expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(
      /rifiutato.*Non posso aiutarti/,
    );
  });

  it("segnala la risposta vuota", async () => {
    const { fetchImpl } = capturing(new Response(JSON.stringify({ status: "completed", output: [] })));
    await expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(/vuota/);
  });

  it.each([
    [401, "{}", /[Cc]hiave API di OpenAI rifiutata/],
    [404, "{}", /[Mm]odello inesistente/],
    [429, '{"error":{"code":"rate_limit_exceeded"}}', /[Tt]roppe richieste/],
    [429, '{"error":{"code":"insufficient_quota"}}', /[Cc]redito OpenAI esaurito/],
    [503, "{}", /sovraccarico/],
    [400, '{"error":{"message":"Invalid schema"}}', /Invalid schema/],
  ])("traduce il codice %i in un'indicazione utile", async (status, body, message) => {
    const { fetchImpl } = capturing(new Response(body, { status }));
    await expect(new OpenAiLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(message);
  });
});

describe("Lo spoglio funziona con OpenAI come con gli altri fornitori", () => {
  it("dal capitolo alle scene del progetto, con id derivati", async () => {
    const { fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    const result = await breakdownScript({
      llm: new OpenAiLlmService({ apiKey: "k", fetchImpl }),
      script: "riga uno\nriga due",
      scriptFile: "cap.md",
    });
    expect(result.scenes[0]!.id).toBe("s001");
    expect(result.meta.service).toBe("openai");
  });
});
