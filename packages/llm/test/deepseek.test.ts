import { describe, expect, it } from "vitest";
import { DeepSeekLlmService } from "../src/deepseekService.js";
import { breakdownJsonSchema, BREAKDOWN_SCHEMA_NAME } from "../src/breakdownSchema.js";
import { breakdownScript } from "../src/breakdown.js";

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

function reply(content: string | null, finish = "stop"): Response {
  return new Response(
    JSON.stringify({ model: "deepseek-flash", choices: [{ message: { content }, finish_reason: finish }] }),
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

describe("DeepSeekLlmService — forma della richiesta", () => {
  it("chiama /chat/completions con la chiave come Bearer e il JSON mode attivo", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new DeepSeekLlmService({ apiKey: "sk-test", fetchImpl }).complete(request());

    expect(captured.url).toBe("https://api.deepseek.com/chat/completions");
    expect(captured.headers?.Authorization).toBe("Bearer sk-test");
    expect(captured.body?.response_format).toEqual({ type: "json_object" });
    expect(captured.body?.stream).toBe(false);
    expect(captured.body?.model).toBe("deepseek-flash");
  });

  it("mette lo schema nel prompt, perché il fornitore non lo accetta come parametro", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new DeepSeekLlmService({ apiKey: "k", fetchImpl }).complete(request());

    const messages = captured.body?.messages as Array<{ role: string; content: string }>;
    const system = messages.find((m) => m.role === "system")!.content;
    // La documentazione chiede di nominare "json" e di mostrare la forma attesa.
    expect(system.toLowerCase()).toContain("json");
    expect(system).toContain('"scenes"');
    expect(system).toContain("establish");
  });

  it("dichiara di garantire solo JSON valido, non lo schema", () => {
    const { fetchImpl } = capturing(reply("{}"));
    expect(new DeepSeekLlmService({ apiKey: "k", fetchImpl }).constraint).toBe("json");
  });

  it("rispetta modello e indirizzo configurati", async () => {
    const { captured, fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    await new DeepSeekLlmService({
      apiKey: "k",
      model: "deepseek-v4-pro",
      baseUrl: "https://proxy.example/",
      fetchImpl,
    }).complete(request());

    expect(captured.url).toBe("https://proxy.example/chat/completions");
    expect(captured.body?.model).toBe("deepseek-v4-pro");
  });
});

describe("DeepSeekLlmService — esiti da gestire", () => {
  it("restituisce l'oggetto interpretato", async () => {
    const { fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    const response = await new DeepSeekLlmService({ apiKey: "k", fetchImpl }).complete(request());
    expect(response.data).toEqual(BREAKDOWN);
  });

  it("segnala la risposta vuota, comportamento documentato del JSON mode", async () => {
    const { fetchImpl } = capturing(reply(null));
    await expect(new DeepSeekLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(/vuota/);
  });

  it("segnala il troncamento invece di passare JSON spezzato al parser", async () => {
    const { fetchImpl } = capturing(reply('{"scenes": [', "length"));
    await expect(new DeepSeekLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(/troncata/);
  });

  it.each([
    [401, /[Cc]hiave API di DeepSeek rifiutata/],
    [402, /[Cc]redito DeepSeek esaurito/],
    [429, /[Tt]roppe richieste/],
    [503, /sovraccarico/],
  ])("traduce il codice %i in un'indicazione utile", async (status, message) => {
    const { fetchImpl } = capturing(new Response("{}", { status }));
    await expect(new DeepSeekLlmService({ apiKey: "k", fetchImpl }).complete(request())).rejects.toThrow(message);
  });
});

describe("Lo spoglio funziona con DeepSeek come con gli altri fornitori", () => {
  it("dal capitolo alle scene del progetto, con id derivati", async () => {
    const { fetchImpl } = capturing(reply(JSON.stringify(BREAKDOWN)));
    const result = await breakdownScript({
      llm: new DeepSeekLlmService({ apiKey: "k", fetchImpl }),
      script: "riga uno\nriga due",
      scriptFile: "cap.md",
    });
    expect(result.scenes[0]!.id).toBe("s001");
    expect(result.meta.service).toBe("deepseek");
  });

  it("uno JSON valido ma di forma sbagliata viene fermato dalla validazione a valle", async () => {
    // Il caso per cui `constraint: "json"` conta: sintassi giusta, forma sbagliata.
    const { fetchImpl } = capturing(reply(JSON.stringify({ scene: "forma sbagliata" })));
    await expect(
      breakdownScript({ llm: new DeepSeekLlmService({ apiKey: "k", fetchImpl }), script: "x", scriptFile: "f" }),
    ).rejects.toThrow(/non è conforme allo schema/);
  });
});
