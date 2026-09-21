import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicLlmService, DEFAULT_ANTHROPIC_MODEL } from "../src/anthropicService.js";
import { breakdownJsonSchema, BREAKDOWN_SCHEMA_NAME } from "../src/breakdownSchema.js";
import { breakdownScript } from "../src/breakdown.js";
import { LlmError } from "../src/service.js";

const BREAKDOWN = {
  scenes: [
    {
      title: "Il faro",
      location: "scogliera",
      time_of_day: "alba",
      characters: ["sara"],
      beats: [
        { function: "establish", summary: "Il faro spento.", intense: false, lines: [], from_line: 1, to_line: 2 },
      ],
    },
  ],
};

/** Client finto: cattura la richiesta e restituisce quel che deciderebbe l'API. */
function fakeClient(reply: Record<string, unknown>, capture?: (params: unknown) => void): Anthropic {
  return {
    messages: {
      parse: (params: unknown) => {
        capture?.(params);
        return Promise.resolve(reply);
      },
    },
  } as unknown as Anthropic;
}

function request() {
  return {
    system: "istruzioni",
    user: "capitolo",
    schema: breakdownJsonSchema(),
    schemaName: BREAKDOWN_SCHEMA_NAME,
  };
}

describe("AnthropicLlmService — forma della richiesta", () => {
  it("usa Claude Opus 5 se non si indica un modello", async () => {
    let params: Record<string, unknown> = {};
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ parsed_output: BREAKDOWN, model: DEFAULT_ANTHROPIC_MODEL }, (p) => {
        params = p as Record<string, unknown>;
      }),
    });

    await service.complete(request());
    expect(params.model).toBe("claude-opus-5");
  });

  it("rispetta il modello configurato", async () => {
    let params: Record<string, unknown> = {};
    const service = new AnthropicLlmService({
      apiKey: "k",
      model: "claude-sonnet-5",
      client: fakeClient({ parsed_output: BREAKDOWN, model: "claude-sonnet-5" }, (p) => {
        params = p as Record<string, unknown>;
      }),
    });

    await service.complete(request());
    expect(params.model).toBe("claude-sonnet-5");
  });

  it("vincola l'output passando lo schema in output_config.format", async () => {
    let params: Record<string, unknown> = {};
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ parsed_output: BREAKDOWN, model: "m" }, (p) => {
        params = p as Record<string, unknown>;
      }),
    });

    await service.complete(request());
    expect(params.output_config).toBeDefined();
    expect((params.output_config as { format?: unknown }).format).toBeDefined();
  });

  it("non passa `thinking`: il modello è configurabile e non tutti accettano lo stesso valore", async () => {
    let params: Record<string, unknown> = {};
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ parsed_output: BREAKDOWN, model: "m" }, (p) => {
        params = p as Record<string, unknown>;
      }),
    });

    await service.complete(request());
    expect(params).not.toHaveProperty("thinking");
  });

  it("dichiara di vincolare con uno schema, non con una grammatica", () => {
    const service = new AnthropicLlmService({ apiKey: "k", client: fakeClient({}) });
    expect(service.constraint).toBe("schema");
  });
});

describe("AnthropicLlmService — esiti da gestire", () => {
  it("restituisce l'output già interpretato secondo lo schema", async () => {
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ parsed_output: BREAKDOWN, model: "claude-opus-5" }),
    });

    const response = await service.complete(request());
    expect(response.data).toEqual(BREAKDOWN);
    expect(response.meta.model).toBe("claude-opus-5");
  });

  it("segnala un rifiuto invece di far finta che sia una risposta vuota", async () => {
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "bio" },
        parsed_output: null,
      }),
    });

    await expect(service.complete(request())).rejects.toThrow(/rifiutato.*bio/s);
  });

  it("segnala una risposta troncata, che altrimenti sembrerebbe uno schema sbagliato", async () => {
    const service = new AnthropicLlmService({
      apiKey: "k",
      maxTokens: 500,
      client: fakeClient({ stop_reason: "max_tokens", parsed_output: null }),
    });

    await expect(service.complete(request())).rejects.toThrow(/troncata a 500/);
  });

  it("segnala un parsed_output nullo", async () => {
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ stop_reason: "end_turn", parsed_output: null }),
    });

    await expect(service.complete(request())).rejects.toThrow(LlmError);
  });

  it("traduce gli errori tipizzati dell'SDK in indicazioni utili", async () => {
    const failing = {
      messages: {
        parse: () =>
          Promise.reject(
            new Anthropic.AuthenticationError(401, { type: "error" }, "unauthorized", new Headers()),
          ),
      },
    } as unknown as Anthropic;

    const service = new AnthropicLlmService({ apiKey: "sbagliata", client: failing });
    await expect(service.complete(request())).rejects.toThrow(/[Cc]hiave API rifiutata/);
  });
});

describe("Lo spoglio funziona con Claude come con gli altri fornitori", () => {
  it("dal capitolo alle scene del progetto, con id derivati", async () => {
    const service = new AnthropicLlmService({
      apiKey: "k",
      client: fakeClient({ parsed_output: BREAKDOWN, model: "claude-opus-5" }),
    });

    const result = await breakdownScript({
      llm: service,
      script: "riga uno\nriga due",
      scriptFile: "cap.md",
    });

    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.id).toBe("s001");
    expect(result.scenes[0]!.beats[0]!.id).toBe("s001-b1");
    expect(result.meta.service).toBe("anthropic");
  });
});
