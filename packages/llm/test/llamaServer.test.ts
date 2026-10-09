import { describe, expect, it } from "vitest";
import { LlamaServerLlmService } from "../src/llamaServerService.js";
import { breakdownScript } from "../src/breakdown.js";
import { LlmError, LlmTruncatedError, type LlmRequest } from "../src/service.js";

/** Uno stream SSE come quello di llama-server, tagliato in pezzi di `size` byte: i confini cadono a metà delle righe. */
function sse(content: string, options: { finish?: string; size?: number } = {}): Response {
  const pieces = content.match(/.{1,7}/gs) ?? [];
  const lines = [
    ...pieces.map((p) => `data: ${JSON.stringify({ model: "qwen", choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: options.finish ?? "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  const bytes = new TextEncoder().encode(lines);
  const size = options.size ?? 13;
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.subarray(i, i + size));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const request: LlmRequest = { system: "sys", user: "usr", schema: { type: "object" }, schemaName: "Prova" };

describe("Modello locale (llama-server di llama.cpp)", () => {
  it("chiede la risposta in streaming, con lo schema come grammatica, e ricompone il JSON", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const service = new LlamaServerLlmService({
      baseUrl: "http://127.0.0.1:18080/",
      model: "qwen3.5-9b",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return sse('{"scene":"è all\'alba","n":3}');
      }) as typeof fetch,
    });
    const response = await service.complete(request);
    expect(response.data).toEqual({ scene: "è all'alba", n: 3 });
    expect(response.meta.model).toBe("qwen3.5-9b");
    expect(calls[0]!.url).toBe("http://127.0.0.1:18080/v1/chat/completions");
    expect(calls[0]!.body).toMatchObject({ stream: true, response_format: { type: "json_schema", json_schema: { name: "Prova", strict: true, schema: { type: "object" } } } });
    expect(service.constraint).toBe("grammar");
  });

  it("l'indirizzo si può chiedere alla prima richiesta: nell'app desktop è lì che il motore parte", async () => {
    let started = 0;
    const service = new LlamaServerLlmService({
      resolveBaseUrl: async () => {
        started++;
        return "http://127.0.0.1:5555";
      },
      fetchImpl: (async (url: string) => {
        expect(url).toBe("http://127.0.0.1:5555/v1/chat/completions");
        return sse("{}");
      }) as typeof fetch,
    });
    expect(started).toBe(0);
    await service.complete(request);
    expect(started).toBe(1);
  });

  it("una risposta tagliata dal limite di token è un troncamento: lo spoglio la divide in parti", async () => {
    const service = new LlamaServerLlmService({ baseUrl: "http://x", fetchImpl: (async () => sse('{"a":', { finish: "length" })) as typeof fetch });
    await expect(service.complete(request)).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it("motore spento, errore HTTP, risposta vuota: messaggi che dicono cosa fare", async () => {
    const off = new LlamaServerLlmService({ baseUrl: "http://127.0.0.1:9", fetchImpl: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    await expect(off.complete(request)).rejects.toThrow("Il modello locale non risponde su http://127.0.0.1:9: è avviato?");
    const bad = new LlamaServerLlmService({ baseUrl: "http://x", fetchImpl: (async () => new Response("context size exceeded", { status: 400 })) as typeof fetch });
    await expect(bad.complete(request)).rejects.toThrow(/HTTP 400\): context size exceeded/);
    const empty = new LlamaServerLlmService({ baseUrl: "http://x", fetchImpl: (async () => sse("")) as typeof fetch });
    await expect(empty.complete(request)).rejects.toBeInstanceOf(LlmError);
  });

  it("lo spoglio vero passa da qui", async () => {
    const answer = {
      scenes: [
        {
          title: "Il faro",
          location: "Il faro",
          time_of_day: "alba",
          characters: ["sara"],
          mood: "calm",
          lighting: "golden",
          beats: [{ function: "establish", summary: "Il faro all'alba.", intense: false, lines: [], characters: [], mood: null, props: [], from_line: 1, to_line: 1 }],
        },
      ],
      cast: [],
      locations: [{ name: "Il faro", description: "Torre bianca su uno sperone di roccia." }],
    };
    const llm = new LlamaServerLlmService({ baseUrl: "http://x", fetchImpl: (async () => sse(JSON.stringify(answer))) as typeof fetch });
    const result = await breakdownScript({ llm, script: "# Il faro\nIl faro all'alba.", scriptFile: "script/ep001.md" });
    expect(result.scenes[0]?.location).toBe("Il faro");
    expect(result.locations).toEqual([{ name: "Il faro", description: "Torre bianca su uno sperone di roccia." }]);
  });
});
