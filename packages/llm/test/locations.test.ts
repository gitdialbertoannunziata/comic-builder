import { describe, expect, it } from "vitest";
import { MockLlmService } from "../src/mockService.js";
import { breakdownScript } from "../src/breakdown.js";
import { describeLocations, describeLocationsPrompt } from "../src/locations.js";
import { breakdownSystemPrompt } from "../src/prompt.js";
import type { LlmRequest, LlmService } from "../src/service.js";

const scene = (location: string) => ({
  title: "T",
  location,
  time_of_day: "sera",
  characters: [],
  mood: "calm",
  lighting: "flat",
  beats: [{ function: "establish", summary: "s", intense: false, lines: [], characters: null, mood: null, props: [], from_line: 1, to_line: 1 }],
});
const answering = (data: unknown, seen: LlmRequest[] = []): LlmService => ({
  name: "finto",
  constraint: "none",
  complete: async (request) => {
    seen.push(request);
    return { data, meta: { model: "x", durationMs: 1 } };
  },
});

describe("Luoghi nello spoglio", () => {
  it("lo spoglio chiede di descrivere ogni luogo, per chi disegna", () => {
    const system = breakdownSystemPrompt();
    expect(system).toContain("`locations` (fuori dalle scene)");
    expect(system).toContain("arredi e oggetti fissi");
  });

  it("un luogo per nome usato dalle scene, con la descrizione del modello", async () => {
    const result = await breakdownScript({
      llm: answering({ scenes: [scene("La stanza"), scene("la Stanza"), scene("Il molo")], cast: [], locations: [{ name: "La Stanza", description: " Studio piccolo, sedia rossa. " }, { name: "Altrove", description: "x" }] }),
      script: "riga",
      scriptFile: "script/ep001.md",
    });
    expect(result.locations).toEqual([
      { name: "La stanza", description: "Studio piccolo, sedia rossa." },
      { name: "Il molo", description: "" },
    ]);
  });

  it("uno spoglio senza luoghi resta valido: le scene non si buttano", async () => {
    const result = await breakdownScript({ llm: answering({ scenes: [scene("Il molo")], cast: [] }), script: "riga", scriptFile: "script/ep001.md" });
    expect(result.locations).toEqual([{ name: "Il molo", description: "" }]);
  });
});

describe("Descrivere i luoghi di un'opera già spogliata", () => {
  const places = [
    { name: "La stanza", scenes: [{ title: "Notifiche", time_of_day: "mattina", beats: ["Il monitor illumina la scrivania."] }] },
    { name: "Il molo", scenes: [] },
  ];

  it("una descrizione per luogo chiesto, nell'ordine chiesto, accoppiata per nome", async () => {
    const seen: LlmRequest[] = [];
    const result = await describeLocations({ llm: answering({ locations: [{ name: "il molo", description: "Assi di legno." }, { name: "La Stanza", description: "Studio." }] }, seen), places, notes: "Regole." });
    expect(result).toEqual([
      { name: "La stanza", description: "Studio." },
      { name: "Il molo", description: "Assi di legno." },
    ]);
    expect(seen[0]!.user).toContain("Regole della serie:\nRegole.");
    expect(seen[0]!.user).toContain("· Notifiche (mattina): Il monitor illumina la scrivania.");
  });

  it("senza modello, l'euristica prende la riga delle regole della serie che descrive il luogo, e non inventa il resto", async () => {
    const notes = "Il mondo.\n• La stanza: scrivania, monitor, sedia rossa, finestra rotta.\n• Fuori dalla finestra: vecchi e ambulanze.";
    expect(await describeLocations({ llm: new MockLlmService(), places, notes })).toEqual([
      { name: "La stanza", description: "scrivania, monitor, sedia rossa, finestra rotta." },
      { name: "Il molo", description: "" },
    ]);
  });

  it("nessun luogo, nessuna richiesta", async () => {
    const seen: LlmRequest[] = [];
    expect(await describeLocations({ llm: answering({}, seen), places: [] })).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(describeLocationsPrompt({ places }).user).not.toContain("Regole della serie");
  });
});
