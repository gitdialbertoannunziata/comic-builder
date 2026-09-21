import { describe, expect, it } from "vitest";
import { breakdownScript, halveChunk, splitScript } from "../src/breakdown.js";
import { heuristicBreakdown } from "../src/mockService.js";
import { LlmTruncatedError, type LlmRequest, type LlmService } from "../src/service.js";

/** Un capitolo lungo: sei scene, ognuna con quattro scambi. */
function chapter(scenes = 6): string {
  const out: string[] = [];
  for (let s = 1; s <= scenes; s++) {
    out.push(`# Scena ${s} — il faro`, "", `Il faro, visto dalla scogliera, momento ${s}.`, "");
    for (let i = 1; i <= 4; i++) out.push(`SARA: Battuta ${s}.${i}, piuttosto lunga per occupare spazio.`, `ELIO: Risposta ${s}.${i}, anche lei lunga abbastanza.`, "");
  }
  return out.join("\n");
}

/** Fornitore che tronca oltre `limit` caratteri di prompt, altrimenti spoglia con l'euristica. */
function truncatingLlm(limit: number) {
  const prompts: string[] = [];
  const llm: LlmService = {
    name: "finto",
    constraint: "grammar",
    complete(request: LlmRequest) {
      prompts.push(request.user);
      if (request.user.length > limit) return Promise.reject(new LlmTruncatedError("troncata", "finto"));
      return Promise.resolve({ data: heuristicBreakdown(request.user), meta: { model: "finto", durationMs: 1 } });
    },
  };
  return { llm, prompts };
}

describe("Divisione del copione", () => {
  const script = chapter();

  it("divide ai titoli di scena e rispetta il limite", () => {
    const chunks = splitScript(script, 900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(900);
      expect(c.text.startsWith("# Scena")).toBe(true);
      expect(c.continuation).toBe(false);
    }
  });

  it("ogni parte conserva i numeri di riga del copione intero", () => {
    const lines = script.split("\n");
    for (const c of splitScript(script, 900)) {
      c.text.split("\n").forEach((line, i) => expect(line).toBe(lines[c.firstLine - 1 + i]));
    }
  });

  it("una scena più lunga del limite si divide ai paragrafi, marcando la continuazione", () => {
    const chunks = splitScript(chapter(1), 250);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.continuation).toBe(false);
    expect(chunks.slice(1).every((c) => c.continuation)).toBe(true);
  });

  it("un copione corto resta una richiesta sola, identica a prima", () => {
    expect(splitScript("# A\n\nSARA: ciao", 6000)).toEqual([{ text: "# A\n\nSARA: ciao", firstLine: 1, continuation: false }]);
  });

  it("dimezza vicino a metà, preferendo un titolo di scena", () => {
    const [a, b] = halveChunk({ text: chapter(2), firstLine: 10, continuation: false })!;
    expect(b.text.startsWith("# Scena 2")).toBe(true);
    expect(b.firstLine).toBe(10 + a.text.split("\n").length);
    expect(b.continuation).toBe(false);
  });
});

describe("Spoglio a parti", () => {
  const script = chapter();

  it("un capitolo lungo si spoglia in più richieste, con le righe giuste", async () => {
    const { llm, prompts } = truncatingLlm(100_000);
    const progress: string[] = [];
    const result = await breakdownScript({ llm, script, scriptFile: "cap.md", chunkChars: 900, onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
    expect(prompts.length).toBeGreaterThan(1);
    expect(result.scenes).toHaveLength(6);
    expect(result.scenes.map((s) => s.id)).toEqual(["s001", "s002", "s003", "s004", "s005", "s006"]);
    // La provenienza punta al copione intero, non alla parte.
    const lines = script.split("\n");
    const last = result.scenes[5]!.beats.at(-1)!.source!;
    expect(lines[last.from_line - 1]).toMatch(/Scena 6|SARA: Battuta 6|ELIO: Risposta 6/);
    expect(progress.at(-1)).toBe(`${prompts.length}/${prompts.length}`);
  });

  it("i personaggi già incontrati passano alle parti successive", async () => {
    const { llm, prompts } = truncatingLlm(100_000);
    await breakdownScript({ llm, script, scriptFile: "cap.md", chunkChars: 900 });
    expect(prompts[0]).not.toContain("Personaggi già incontrati");
    expect(prompts[1]).toContain("Personaggi già incontrati, da chiamare con questi ref se ricompaiono: elio, sara.");
  });

  it("una parte troncata si dimezza e si riprova, e lo si dice", async () => {
    const { llm, prompts } = truncatingLlm(1400);
    const result = await breakdownScript({ llm, script, scriptFile: "cap.md", chunkChars: 100_000 });
    expect(prompts[0]!.length).toBeGreaterThan(1400);
    expect(result.scenes).toHaveLength(6);
    expect(result.issues.some((i) => i.code === "breakdown.split")).toBe(true);
  });

  it("una scena divisa a metà torna una scena sola", async () => {
    const { llm } = truncatingLlm(100_000);
    const result = await breakdownScript({ llm, script: chapter(1), scriptFile: "cap.md", chunkChars: 250 });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]!.beats.length).toBeGreaterThan(3);
  });

  it("se non si può più dividere, l'errore dice cosa fare", async () => {
    const { llm } = truncatingLlm(10);
    await expect(breakdownScript({ llm, script: "SARA: una riga sola", scriptFile: "cap.md" })).rejects.toThrow(/alza il limite di token/);
  });
});

describe("Contesto degli altri capitoli", () => {
  it("personaggi esistenti (con nome) e riassunto del precedente arrivano già alla prima parte", async () => {
    const { llm, prompts } = truncatingLlm(100_000);
    await breakdownScript({
      llm,
      script: "# Scena\n\nSARA: ciao",
      scriptFile: "cap2.md",
      context: { characters: [{ ref: "sara", name: "Sara Bellini" }, { ref: "elio", name: "" }], previously: "Capitolo 1 «La lanterna»: il faro è spento." },
    });
    expect(prompts[0]).toContain("Nei capitoli precedenti (solo contesto, da non spogliare):\nCapitolo 1 «La lanterna»: il faro è spento.");
    expect(prompts[0]).toContain("da chiamare con questi ref se ricompaiono: elio, sara (Sara Bellini).");
  });
});
