import { describe, expect, it } from "vitest";
import { mergeRerun } from "../src/script/mergeRerun.js";
import { repairPage } from "../src/validate/repair.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { validateDocument } from "../src/validate/validateDocument.js";
import { PageSchema, type Page } from "../src/schema/page.js";
import { SceneSchema, type Scene } from "../src/schema/scenes.js";
import type { BeatFunction } from "../src/schema/scenes.js";

const BUILD = {
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr" as const,
};

function scene(functions: BeatFunction[], summaries?: string[]): Scene {
  return SceneSchema.parse({
    id: "s001",
    title: "scena",
    location: "faro",
    time_of_day: "alba",
    characters: ["sara", "elio"],
    beats: functions.map((fn, i) => ({
      id: `s001-b${i + 1}`,
      function: fn,
      summary: summaries?.[i] ?? `beat ${i + 1}`,
    })),
  });
}

function firstPage(s: Scene): Page {
  return buildPagesFromScene({ ...BUILD, scene: s })[0]!;
}

/** Copia profonda, per simulare l'autore che modifica il documento a mano. */
function clone(page: Page): Page {
  return structuredClone(page);
}

const SIX: BeatFunction[] = ["establish", "entrance", "dialogue", "reaction", "action", "close"];

describe("mergeRerun — criterio d'uscita F1: rigenerare non perde le modifiche a mano (§10.3)", () => {
  it("senza modifiche a mano, il re-run identico non cambia nulla", () => {
    const base = firstPage(scene(SIX));
    const result = mergeRerun(base, clone(base), clone(base));
    expect(result.changes).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual(base);
  });

  it("accetta la proposta dove l'autore non ha toccato niente", () => {
    const base = firstPage(scene(SIX));
    const incoming = firstPage(scene(SIX, ["Il faro riscritto", "b2", "b3", "b4", "b5", "b6"]));
    const result = mergeRerun(base, incoming, clone(base));

    expect(result.conflicts).toEqual([]);
    expect(result.merged.panels[0]!.action).toBe("Il faro riscritto");
    expect(result.changes.map((c) => c.path)).toContain("panels[ep001-p001-01].action");
  });

  it("tiene la modifica a mano dove il generatore non ha cambiato nulla", () => {
    const base = firstPage(scene(SIX));
    const current = clone(base);
    current.panels[0]!.camera.shot = "ECU";
    current.panels[0]!.camera.lighting = "night";

    const result = mergeRerun(base, clone(base), current);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.panels[0]!.camera.shot).toBe("ECU");
    expect(result.merged.panels[0]!.camera.lighting).toBe("night");
  });

  it("in conflitto tiene la mano dell'autore e mette la proposta da approvare", () => {
    const base = firstPage(scene(SIX));
    const incoming = firstPage(scene(SIX, ["Proposta del re-run", "b2", "b3", "b4", "b5", "b6"]));
    const current = clone(base);
    current.panels[0]!.action = "Riscritta a mano dall'autore";

    const result = mergeRerun(base, incoming, current);

    // Il documento non perde il lavoro a mano...
    expect(result.merged.panels[0]!.action).toBe("Riscritta a mano dall'autore");
    // ...e la proposta non sparisce: finisce nell'elenco da approvare.
    const conflict = result.conflicts.find((c) => c.path === "panels[ep001-p001-01].action");
    expect(conflict).toBeDefined();
    expect(conflict!.incoming).toBe("Proposta del re-run");
    expect(conflict!.current).toBe("Riscritta a mano dall'autore");
    expect(conflict!.base).toBe("beat 1");
  });

  it("modifiche su campi diversi dello stesso pannello convivono senza conflitto", () => {
    const base = firstPage(scene(SIX));
    const incoming = firstPage(scene(SIX, ["Azione riscritta dallo script", "b2", "b3", "b4", "b5", "b6"]));
    const current = clone(base);
    current.panels[0]!.camera.angle = "worms"; // l'autore ha deciso l'inquadratura

    const result = mergeRerun(base, incoming, current);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.panels[0]!.action).toBe("Azione riscritta dallo script");
    expect(result.merged.panels[0]!.camera.angle).toBe("worms");
  });

  it("non tocca l'arte importata a mano, senza bisogno di regole dedicate", () => {
    const base = firstPage(scene(SIX));
    const current = clone(base);
    current.panels[0]!.art = { source: "art/ep001-p001-01.psd", status: "inked" };

    const result = mergeRerun(base, firstPage(scene(SIX)), current);

    // base e incoming portano lo stesso default del generatore, quindi la
    // regola a tre vie da sola protegge l'arte: nessun caso speciale.
    expect(result.merged.panels[0]!.art.source).toBe("art/ep001-p001-01.psd");
    expect(result.conflicts).toEqual([]);
  });
});

describe("mergeRerun — pannelli aggiunti e rimossi", () => {
  it("aggiunge i pannelli dei beat nuovi", () => {
    const base = firstPage(scene(["establish", "dialogue", "close"]));
    const incoming = firstPage(scene(["establish", "dialogue", "reaction", "close"]));
    const result = mergeRerun(base, incoming, clone(base));

    expect(result.merged.panels).toHaveLength(4);
    expect(result.changes.some((c) => c.path === "panels[ep001-p001-04]" && c.from === null)).toBe(true);
  });

  it("rimuove un pannello non più proposto, se l'autore non l'aveva toccato", () => {
    const base = firstPage(scene(["establish", "dialogue", "reaction", "close"]));
    const incoming = firstPage(scene(["establish", "dialogue", "close"]));
    const result = mergeRerun(base, incoming, clone(base));

    expect(result.merged.panels.map((p) => p.id)).not.toContain("ep001-p001-04");
    expect(result.conflicts).toEqual([]);
  });

  it("NON rimuove un pannello lavorato a mano: lo tiene e apre un conflitto", () => {
    const base = firstPage(scene(["establish", "dialogue", "reaction", "close"]));
    const incoming = firstPage(scene(["establish", "dialogue", "close"]));
    const current = clone(base);
    current.panels[3]!.art = { source: "art/disegnato.psd", status: "inked" };

    const result = mergeRerun(base, incoming, current);

    expect(result.merged.panels.map((p) => p.id)).toContain("ep001-p001-04");
    const conflict = result.conflicts.find((c) => c.path === "panels[ep001-p001-04]");
    expect(conflict?.incoming).toBeNull();
  });

  it("non resuscita un pannello che l'autore aveva cancellato", () => {
    const base = firstPage(scene(SIX));
    const incoming = firstPage(scene(SIX));
    const current = clone(base);
    current.panels = current.panels.filter((p) => p.id !== "ep001-p001-03");

    const result = mergeRerun(base, incoming, current);
    expect(result.merged.panels.map((p) => p.id)).not.toContain("ep001-p001-03");
  });
});

describe("mergeRerun — balloon", () => {
  function dialogueScene(text: string): Scene {
    const s = scene(["establish", "dialogue", "close"]);
    s.beats[1]!.lines = [{ speaker: "sara", text, type: "speech" }];
    return s;
  }

  it("aggiorna il testo di una battuta che l'autore non ha ritoccato", () => {
    const base = firstPage(dialogueScene("Prima versione."));
    const incoming = firstPage(dialogueScene("Versione corretta dallo sceneggiatore."));
    const result = mergeRerun(base, incoming, clone(base));

    expect(result.merged.panels[1]!.balloons[0]!.text[0]!.t).toBe("Versione corretta dallo sceneggiatore.");
    expect(result.conflicts).toEqual([]);
  });

  it("conserva la posizione data a mano a un balloon mentre ne aggiorna il testo", () => {
    const base = firstPage(dialogueScene("Prima versione."));
    const incoming = firstPage(dialogueScene("Testo nuovo."));
    const current = clone(base);
    current.panels[1]!.balloons[0]!.anchor = { x: 0.6, y: 0.4 };

    const result = mergeRerun(base, incoming, current);

    expect(result.merged.panels[1]!.balloons[0]!.text[0]!.t).toBe("Testo nuovo.");
    expect(result.merged.panels[1]!.balloons[0]!.anchor).toEqual({ x: 0.6, y: 0.4 });
    expect(result.conflicts).toEqual([]);
  });

  it("apre un conflitto se il testo è stato riscritto da entrambe le parti", () => {
    const base = firstPage(dialogueScene("Prima versione."));
    const incoming = firstPage(dialogueScene("Versione dello sceneggiatore."));
    const current = clone(base);
    current.panels[1]!.balloons[0]!.text = [{ t: "Versione dell'autore." }];

    const result = mergeRerun(base, incoming, current);

    expect(result.merged.panels[1]!.balloons[0]!.text[0]!.t).toBe("Versione dell'autore.");
    expect(result.conflicts.some((c) => c.balloonId === "ep001-p001-02-b1")).toBe(true);
  });
});

describe("mergeRerun — il risultato resta un documento valido", () => {
  it("produce un documento che passa validateDocument, anche aggiungendo pannelli", () => {
    const base = firstPage(scene(["establish", "dialogue", "close"]));
    const incoming = firstPage(scene(["establish", "dialogue", "reaction", "close"]));
    const result = mergeRerun(base, incoming, clone(base));

    expect(() => PageSchema.parse(result.merged)).not.toThrow();
    expect(validateDocument(result.merged)).toEqual([]);
  });

  it("ricompone l'ordine di lettura quando il lay-out a mano vince il conflitto", () => {
    const base = firstPage(scene(["establish", "dialogue", "close"]));
    const incoming = firstPage(scene(["establish", "dialogue", "reaction", "close"]));
    const current = clone(base);
    // L'autore ha ritoccato il lay-out: il suo vince, ma non conosce il pannello nuovo.
    if (current.layout.mode === "page") current.layout.gutter = { x: 30, y: 30 };

    const result = mergeRerun(base, incoming, current);
    const order = result.merged.layout.mode === "page" ? result.merged.layout.reading_order : [];

    expect(order).toHaveLength(result.merged.panels.length);
    expect(new Set(order)).toEqual(new Set(result.merged.panels.map((p) => p.id)));
    expect(result.repairs.some((r) => r.code === "repair.order-appended")).toBe(true);
  });
});

describe("repairPage — ripara solo ciò che ha una risposta ovvia (§12)", () => {
  it("accoda i pannelli mancanti dall'ordine di lettura", () => {
    const page = firstPage(scene(["establish", "dialogue", "close"]));
    if (page.layout.mode === "page") page.layout.reading_order = ["ep001-p001-01"];

    const { page: repaired, repairs } = repairPage(page);
    const order = repaired.layout.mode === "page" ? repaired.layout.reading_order : [];

    expect(order).toEqual(["ep001-p001-01", "ep001-p001-02", "ep001-p001-03"]);
    expect(repairs).toHaveLength(2);
  });

  it("toglie dall'ordine gli id che non esistono e i duplicati", () => {
    const page = firstPage(scene(["establish", "dialogue", "close"]));
    if (page.layout.mode === "page") {
      page.layout.reading_order = ["ep001-p001-01", "fantasma", "ep001-p001-01", "ep001-p001-02", "ep001-p001-03"];
    }

    const { page: repaired, repairs } = repairPage(page);
    const order = repaired.layout.mode === "page" ? repaired.layout.reading_order : [];

    expect(order).toEqual(["ep001-p001-01", "ep001-p001-02", "ep001-p001-03"]);
    expect(repairs.map((r) => r.code)).toEqual(
      expect.arrayContaining(["repair.order-stale-id", "repair.order-duplicate"]),
    );
  });

  it("accorcia uno span che esce dalla griglia invece di lasciarlo invalido", () => {
    const page = firstPage(scene(["establish", "dialogue", "close"]));
    page.panels[0]!.area = { col: 2, row: 0, col_span: 4, row_span: 1, z: 0 };

    const { page: repaired, repairs } = repairPage(page);

    expect(repaired.panels[0]!.area.col_span).toBe(1);
    expect(repairs.some((r) => r.code === "repair.span-clamped")).toBe(true);
  });

  it("non inventa riparazioni su un documento già sano", () => {
    const page = firstPage(scene(SIX));
    const { page: repaired, repairs } = repairPage(page);
    expect(repairs).toEqual([]);
    expect(repaired).toEqual(page);
  });
});
