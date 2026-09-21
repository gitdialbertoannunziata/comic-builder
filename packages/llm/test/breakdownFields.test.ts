import { describe, expect, it } from "vitest";
import { breakdownScript } from "../src/breakdown.js";
import type { Breakdown } from "../src/breakdownSchema.js";
import type { LlmService } from "../src/service.js";

/** Un fornitore che risponde sempre la stessa cosa: si verifica cosa ne fa lo spoglio. */
function replying(data: Breakdown): LlmService {
  return {
    name: "fisso",
    constraint: "schema",
    complete: () => Promise.resolve({ data, meta: { model: "fisso", durationMs: 0 } }),
  };
}

const SCRIPT = "riga uno\nriga due\nriga tre";

function breakdown(beat: Partial<Breakdown["scenes"][number]["beats"][number]>): Breakdown {
  return {
    scenes: [
      {
        title: "Il faro",
        location: "scogliera",
        time_of_day: "alba",
        characters: ["sara"],
        mood: "tense",
        lighting: "golden",
        beats: [
          {
            function: "dialogue",
            summary: "Parlano.",
            intense: false,
            lines: [],
            characters: null,
            mood: null,
            props: [],
            from_line: 1,
            to_line: 2,
            ...beat,
          },
        ],
      },
    ],
  };
}

async function run(data: Breakdown) {
  return breakdownScript({ llm: replying(data), script: SCRIPT, scriptFile: "cap.md" });
}

describe("Lo spoglio conserva i campi nuovi del contratto", () => {
  it("il tipo di balloon arriva alla scena, invece di diventare sempre speech", async () => {
    const result = await run(
      breakdown({
        lines: [
          { speaker: "sara", text: "Zitto.", type: "whisper" },
          { speaker: null, text: "Tre ore prima.", type: "caption" },
        ],
      }),
    );
    expect(result.scenes[0]!.beats[0]!.lines.map((l) => l.type)).toEqual(["whisper", "caption"]);
  });

  it("tono e luce della scena, tono e oggetti del beat passano intatti", async () => {
    const result = await run(breakdown({ mood: "dread", props: [" lanterna ", ""] }));
    const scene = result.scenes[0]!;
    expect(scene.mood).toBe("tense");
    expect(scene.lighting).toBe("golden");
    expect(scene.beats[0]!.mood).toBe("dread");
    expect(scene.beats[0]!.props).toEqual(["lanterna"]);
  });

  it("una vignetta dichiarata vuota resta vuota", async () => {
    const result = await run(breakdown({ function: "establish", characters: [] }));
    expect(result.scenes[0]!.beats[0]!.characters).toEqual([]);
  });
});

describe("Riparazioni sui personaggi in vignetta", () => {
  it("chi parla in vignetta ma non è fra i presenti viene aggiunto, e lo si dice", async () => {
    const result = await run(
      breakdown({
        characters: [{ ref: "sara", expression: "", wardrobe: "" }],
        lines: [{ speaker: "elio", text: "Aveva le chiavi.", type: "speech" }],
      }),
    );
    const beat = result.scenes[0]!.beats[0]!;
    expect(beat.characters!.map((c) => c.ref)).toEqual(["sara", "elio"]);
    expect(result.issues.map((i) => i.code)).toContain("breakdown.speaker-in-panel");
    // …e finisce anche nel cast della scena, altrimenti il lint lo rifiuterebbe.
    expect(result.scenes[0]!.characters).toContain("elio");
  });

  it("chi parla fuori campo non viene messo in vignetta", async () => {
    const result = await run(
      breakdown({
        characters: [{ ref: "sara", expression: "", wardrobe: "" }],
        lines: [{ speaker: "elio", text: "Sono giù!", type: "offpanel" }],
      }),
    );
    expect(result.scenes[0]!.beats[0]!.characters!.map((c) => c.ref)).toEqual(["sara"]);
    expect(result.issues.map((i) => i.code)).not.toContain("breakdown.speaker-in-panel");
  });
});
