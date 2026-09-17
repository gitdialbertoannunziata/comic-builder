import { describe, expect, it } from "vitest";
import { paginateBeats, chooseTemplate } from "../src/script/paginate.js";
import { BeatSchema, type Beat } from "../src/schema/scenes.js";
import type { BeatFunction } from "../src/schema/scenes.js";

function beats(functions: BeatFunction[]): Beat[] {
  return functions.map((fn, i) => BeatSchema.parse({ id: `b${i}`, function: fn, summary: `beat ${i}` }));
}

describe("paginateBeats (§6.3: 3–6 pannelli per pagina)", () => {
  it("non produce pagine per una scena senza beat", () => {
    expect(paginateBeats(0)).toEqual([]);
  });

  it("copre esattamente tutti i beat, per ogni lunghezza fino a 40", () => {
    for (let n = 1; n <= 40; n++) {
      const sizes = paginateBeats(n);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it("usa solo dimensioni che il catalogo sa esprimere", () => {
    const representable = new Set([1, 3, 4, 6]);
    for (let n = 1; n <= 40; n++) {
      for (const size of paginateBeats(n)) {
        expect(representable.has(size)).toBe(true);
      }
    }
  });

  it("minimizza il numero di pagine", () => {
    expect(paginateBeats(6)).toEqual([6]);
    expect(paginateBeats(12)).toEqual([6, 6]);
    expect(paginateBeats(4)).toEqual([4]);
    expect(paginateBeats(3)).toEqual([3]);
  });

  it("a parità di pagine preferisce non ripiegare su uno splash di resto", () => {
    // 7 = 6+1 (uno splash) oppure 4+3 (nessuno): vince 4+3.
    expect(paginateBeats(7)).toEqual([4, 3]);
    // 9 = 6+3, non 6+1+1+1.
    expect(paginateBeats(9)).toEqual([6, 3]);
  });

  it("ricorre allo splash solo quando non c'è alternativa", () => {
    expect(paginateBeats(1)).toEqual([1]);
    expect(paginateBeats(2)).toEqual([1, 1]);
    expect(paginateBeats(5)).toEqual([4, 1]);
  });

  it("è deterministica", () => {
    for (let n = 1; n <= 20; n++) {
      expect(paginateBeats(n)).toEqual(paginateBeats(n));
    }
  });
});

describe("chooseTemplate — il modello sceglie dal catalogo, non inventa (§7.3)", () => {
  it("un beat solo diventa uno splash", () => {
    expect(chooseTemplate(beats(["reveal"])).id).toBe("splash");
  });

  it("quattro beat che aprono stabilendo il luogo usano top-splash-3", () => {
    expect(chooseTemplate(beats(["establish", "entrance", "dialogue", "close"])).id).toBe("top-splash-3");
  });

  it("quattro beat che non aprono una scena usano t-layout", () => {
    expect(chooseTemplate(beats(["action", "reaction", "dialogue", "close"])).id).toBe("t-layout");
  });

  it("sei beat prevalentemente di dialogo usano nine-grid-dialogue", () => {
    const page = beats(["dialogue", "dialogue", "dialogue", "reaction", "dialogue", "close"]);
    expect(chooseTemplate(page).id).toBe("nine-grid-dialogue");
  });

  it("sei beat vari usano classic-6", () => {
    const page = beats(["establish", "entrance", "action", "reaction", "reveal", "close"]);
    expect(chooseTemplate(page).id).toBe("classic-6");
  });

  it("rifiuta un numero di beat che nessun template accoglie", () => {
    expect(() => chooseTemplate(beats(["dialogue", "dialogue"]))).toThrow(/Nessun template/);
  });

  it("ogni dimensione prodotta da paginateBeats ha un template", () => {
    for (let n = 1; n <= 40; n++) {
      for (const size of paginateBeats(n)) {
        const fns: BeatFunction[] = Array.from({ length: size }, () => "dialogue");
        expect(() => chooseTemplate(beats(fns))).not.toThrow();
      }
    }
  });
});
