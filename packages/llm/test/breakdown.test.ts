import { describe, expect, it } from "vitest";
import {
  buildPagesFromScene,
  validateDocument,
  lintPage,
  PageSchema,
  SceneSchema,
} from "@comic-builder/core";
import { MockLlmService, heuristicBreakdown } from "../src/mockService.js";
import { OllamaLlmService } from "../src/ollamaService.js";
import { breakdownScript } from "../src/breakdown.js";
import { BreakdownSchema, breakdownJsonSchema } from "../src/breakdownSchema.js";
import { LlmError, type LlmService } from "../src/service.js";

const SCRIPT = `# Il faro di Capo Vento

Il faro sulla scogliera, all'alba. La lanterna è spenta.

Sara arriva dal sentiero con la borsa degli attrezzi.

SARA: È spenta da quanto?
ELIO: Dalle due. Ho provato di tutto.

Elio le mostra il quadro elettrico annerito.

# In cima alla torre

La lente della lanterna è stata smontata e portata via.

SARA: Nessun segno di scasso.
ELIO: Aveva le chiavi.
`;

describe("MockLlmService — spoglio euristico, offline e deterministico (§11.1)", () => {
  it("divide lo script in scene sui titoli", () => {
    const result = heuristicBreakdown(SCRIPT);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]!.title).toBe("Il faro di Capo Vento");
    expect(result.scenes[1]!.title).toBe("In cima alla torre");
  });

  it("riconosce le battute nella forma NOME: testo", () => {
    const result = heuristicBreakdown(SCRIPT);
    const dialogue = result.scenes[0]!.beats.find((b) => b.lines.length > 0);
    expect(dialogue?.function).toBe("dialogue");
    expect(dialogue?.lines).toEqual([
      { speaker: "sara", text: "È spenta da quanto?", type: "speech" },
      { speaker: "elio", text: "Dalle due. Ho provato di tutto.", type: "speech" },
    ]);
  });

  it("deriva i personaggi dagli speaker, in forma di ref stabile", () => {
    const result = heuristicBreakdown(SCRIPT);
    expect(result.scenes[0]!.characters).toEqual(["sara", "elio"]);
  });

  it("indovina l'ora del giorno quando il testo la nomina", () => {
    expect(heuristicBreakdown(SCRIPT).scenes[0]!.time_of_day).toBe("alba");
  });

  it("produce un output conforme al contratto di schema", () => {
    expect(() => BreakdownSchema.parse(heuristicBreakdown(SCRIPT))).not.toThrow();
  });

  it("è deterministico", () => {
    expect(heuristicBreakdown(SCRIPT)).toEqual(heuristicBreakdown(SCRIPT));
  });

  it("non esplode su uno script senza struttura riconoscibile", () => {
    const result = heuristicBreakdown("solo una riga senza titoli né dialoghi");
    expect(result.scenes).toHaveLength(1);
    expect(() => BreakdownSchema.parse(result)).not.toThrow();
  });

  it("accetta indifferentemente lo script grezzo o il prompt con le righe numerate", () => {
    const numbered = SCRIPT.split("\n")
      .map((l, i) => `${i + 1}\t${l}`)
      .join("\n");
    const fromRaw = heuristicBreakdown(SCRIPT);
    const fromPrompt = heuristicBreakdown(`Spoglia questo capitolo.\n\n${numbered}`);
    expect(fromPrompt.scenes.map((s) => s.title)).toEqual(fromRaw.scenes.map((s) => s.title));
    // I numeri di riga restano quelli dello script originale.
    expect(fromPrompt.scenes[0]!.beats[0]!.from_line).toBe(fromRaw.scenes[0]!.beats[0]!.from_line);
  });
});

describe("breakdownScript — dal capitolo alle scene del progetto", () => {
  it("assegna id derivati e non chiede al modello di inventarli (§5.3)", async () => {
    const result = await breakdownScript({
      llm: new MockLlmService(),
      script: SCRIPT,
      scriptFile: "script/cap-001.md",
    });

    expect(result.scenes.map((s) => s.id)).toEqual(["s001", "s002"]);
    expect(result.scenes[0]!.beats[0]!.id).toBe("s001-b1");
    for (const scene of result.scenes) {
      expect(() => SceneSchema.parse(scene)).not.toThrow();
    }
  });

  it("porta la provenienza fino al beat (§10.1)", async () => {
    const result = await breakdownScript({
      llm: new MockLlmService(),
      script: SCRIPT,
      scriptFile: "script/cap-001.md",
    });
    const source = result.scenes[0]!.beats[0]!.source;
    expect(source?.file).toBe("script/cap-001.md");
    expect(source!.from_line).toBeGreaterThan(0);
    expect(source!.to_line).toBeLessThanOrEqual(SCRIPT.split("\n").length);
  });

  it("scarta una provenienza che punta fuori dallo script, invece di fidarsene", async () => {
    const liar: LlmService = {
      name: "bugiardo",
      constraint: "none",
      complete: async () => ({
        data: {
          scenes: [
            {
              title: "T",
              location: "L",
              time_of_day: "sera",
              characters: ["sara"], mood: "calm", lighting: "flat",
              beats: [
                { function: "establish", summary: "s", intense: false, lines: [], characters: null, mood: null, props: [], from_line: 900, to_line: 950 },
              ],
            },
          ],
        },
        meta: { model: "x", durationMs: 1 },
      }),
    };

    const result = await breakdownScript({ llm: liar, script: SCRIPT, scriptFile: "f.md" });
    expect(result.scenes[0]!.beats[0]!.source).toBeNull();
    expect(result.issues.map((i) => i.code)).toContain("breakdown.source-out-of-range");
  });

  it("aggiunge alla scena uno speaker che il modello aveva dimenticato di dichiarare", async () => {
    const forgetful: LlmService = {
      name: "smemorato",
      constraint: "none",
      complete: async () => ({
        data: {
          scenes: [
            {
              title: "T",
              location: "L",
              time_of_day: "sera",
              characters: [], mood: "calm", lighting: "flat",
              beats: [
                {
                  function: "dialogue",
                  summary: "parlano",
                  intense: false,
                  lines: [{ speaker: "elio", text: "ciao", type: "speech" }],
                  characters: null,
                  mood: null,
                  props: [],
                  from_line: 1,
                  to_line: 2,
                },
              ],
            },
          ],
        },
        meta: { model: "x", durationMs: 1 },
      }),
    };

    const result = await breakdownScript({ llm: forgetful, script: SCRIPT, scriptFile: "f.md" });
    expect(result.scenes[0]!.characters).toContain("elio");
    expect(result.issues.map((i) => i.code)).toContain("breakdown.speaker-added");
  });

  it("fallisce chiaro se l'output non ha la forma giusta, invece di inventare un documento", async () => {
    const broken: LlmService = {
      name: "rotto",
      constraint: "none",
      complete: async () => ({ data: { scene: "sbagliato" }, meta: { model: "x", durationMs: 1 } }),
    };

    await expect(breakdownScript({ llm: broken, script: SCRIPT, scriptFile: "f.md" })).rejects.toThrow(LlmError);
  });
});

describe("La catena completa di F1, senza alcun modello acceso", () => {
  it("da un capitolo in prosa produce pagine valide", async () => {
    const { scenes } = await breakdownScript({
      llm: new MockLlmService(),
      script: SCRIPT,
      scriptFile: "script/cap-001.md",
    });

    let pageNumber = 1;
    const allPages = [];
    for (const scene of scenes) {
      const pages = buildPagesFromScene({
        chapterId: "ep001",
        scene,
        firstPageNumber: pageNumber,
        primaryTarget: "digital-page",
        gutter: { x: 14, y: 18 },
        readingDirection: "ltr",
      });
      pageNumber += pages.length;
      allPages.push(...pages);
    }

    expect(allPages.length).toBeGreaterThan(0);
    for (const page of allPages) {
      expect(() => PageSchema.parse(page)).not.toThrow();
      expect(validateDocument(page)).toEqual([]);
      expect(lintPage(page).filter((i) => i.level === "error")).toEqual([]);
    }
  });
});

describe("OllamaLlmService — protocollo verificato senza un modello acceso", () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) =>
      handler(String(url), init ?? {})) as unknown as typeof fetch;
  }

  it("chiede /api/chat senza stream, con lo schema in `format` e temperatura bassa", async () => {
    let captured: Record<string, unknown> = {};
    const service = new OllamaLlmService({
      model: "llama3.1:8b",
      fetchImpl: fakeFetch((url, init) => {
        expect(url).toBe("http://127.0.0.1:11434/api/chat");
        captured = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ model: "llama3.1:8b", message: { content: '{"scenes":[]}' } }));
      }),
    });

    await service.complete({
      system: "s",
      user: "u",
      schema: breakdownJsonSchema(),
      schemaName: "Breakdown",
    });

    expect(captured.stream).toBe(false);
    expect(captured.model).toBe("llama3.1:8b");
    expect(captured.format).toMatchObject({ type: "object" });
    expect(captured.options).toMatchObject({ temperature: 0.2 });
  });

  it("lega fetch al suo ricevente, altrimenti nel browser è «Illegal invocation»", async () => {
    // Riproduce in Node un baco che si vedeva solo a pagina aperta: `fetch`
    // preso come riferimento nudo e invocato come metodo dell'adapter. Qui il
    // finto `fetch` pretende `globalThis` come ricevente, esattamente come fa
    // il browser — senza `.bind` questo test fallisce.
    const original = globalThis.fetch;
    let calledOnWindow = false;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: function (this: unknown) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        calledOnWindow = true;
        return Promise.resolve(new Response(JSON.stringify({ message: { content: "{}" } })));
      },
    });

    try {
      const service = new OllamaLlmService({ model: "m" });
      await service.complete({ system: "", user: "", schema: {}, schemaName: "S" });
      expect(calledOnWindow).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: original });
    }
  });

  it("dichiara di vincolare l'output con una grammatica", () => {
    expect(new OllamaLlmService({ model: "m", fetchImpl: fakeFetch(() => new Response("{}")) }).constraint).toBe(
      "grammar",
    );
  });

  it("dice che Ollama non è in esecuzione, invece di un errore di rete qualsiasi", async () => {
    const service = new OllamaLlmService({
      model: "m",
      fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
    });

    await expect(
      service.complete({ system: "", user: "", schema: {}, schemaName: "S" }),
    ).rejects.toThrow(/non raggiungibile/);
  });

  it("segnala il modello quando risponde con JSON non valido nonostante la grammatica", async () => {
    const service = new OllamaLlmService({
      model: "modello-scarso",
      fetchImpl: fakeFetch(() => new Response(JSON.stringify({ message: { content: "non json" } }))),
    });

    await expect(
      service.complete({ system: "", user: "", schema: {}, schemaName: "S" }),
    ).rejects.toThrow(/modello-scarso/);
  });

  it("riporta l'errore che Ollama restituisce nel corpo", async () => {
    const service = new OllamaLlmService({
      model: "assente",
      fetchImpl: fakeFetch(() => new Response(JSON.stringify({ error: 'model "assente" not found' }))),
    });

    await expect(
      service.complete({ system: "", user: "", schema: {}, schemaName: "S" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("Schema JSON per il decoding vincolato", () => {
  it("è derivato dallo zod, non scritto a mano", () => {
    const schema = breakdownJsonSchema();
    expect(schema).toMatchObject({ type: "object" });
    const scenes = (schema as { properties: { scenes: { type: string } } }).properties.scenes;
    expect(scenes.type).toBe("array");
  });

  it("non contiene $ref: molti motori di grammatica non li risolvono", () => {
    expect(JSON.stringify(breakdownJsonSchema())).not.toContain("$ref");
  });

  it("enumera le sette funzioni di beat, così il modello non può inventarne altre", () => {
    const json = JSON.stringify(breakdownJsonSchema());
    for (const fn of ["establish", "entrance", "dialogue", "reaction", "reveal", "action", "close"]) {
      expect(json).toContain(fn);
    }
  });
});
