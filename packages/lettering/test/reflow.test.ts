import { describe, expect, it } from "vitest";
import { wrapText, blockWidth, lineWidth } from "../src/reflow.js";
import { loadTestFont } from "./helpers/loadTestFont.js";

const font = loadTestFont();
const FONT_SIZE = 26;

function text(t: string) {
  return [{ t }];
}

describe("wrapText — misurazione reale dei glifi (§8.1)", () => {
  it("non spezza un testo che entra in una riga", () => {
    const lines = wrapText(text("Ciao Marco"), font, FONT_SIZE, 400);
    expect(lines).toHaveLength(1);
  });

  it("spezza un testo più largo del massimo consentito", () => {
    const long = text(
      "Non c'è più niente qui dentro, pensò Marco guardando il garage vuoto e polveroso.",
    );
    const lines = wrapText(long, font, FONT_SIZE, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(lineWidth(line, font, FONT_SIZE)).toBeLessThanOrEqual(200 + 1); // tolleranza arrotondamento
    }
  });

  it("isola una parola più larga del massimo consentito sulla propria riga, senza spezzarla", () => {
    const lines = wrapText(text("una supercalifragilistichespiralidoso qui"), font, FONT_SIZE, 150);
    expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual([
      "una",
      "supercalifragilistichespiralidoso",
      "qui",
    ]);
    // La parola lunga eccede deliberatamente maxWidthPx: non esiste un punto di rottura.
    expect(lineWidth(lines[1]!, font, FONT_SIZE)).toBeGreaterThan(150);
  });

  it("la larghezza del blocco non supera mai maxWidthPx", () => {
    const long = text("Qui dentro non è rimasto più niente da vedere o da dire a nessuno.");
    const maxWidth = 220;
    const lines = wrapText(long, font, FONT_SIZE, maxWidth);
    expect(blockWidth(lines, font, FONT_SIZE)).toBeLessThanOrEqual(maxWidth + 1);
  });

  it("preserva l'enfasi per parola dopo il wrap", () => {
    const runs = [{ t: "Non c'è più " }, { t: "niente", em: "bold" as const }, { t: " qui dentro." }];
    const lines = wrapText(runs, font, FONT_SIZE, 1000);
    const flat = lines.flat();
    const boldToken = flat.find((t) => t.text === "niente");
    expect(boldToken?.em).toBe("bold");
  });

  it("evita un'ultima riga con una sola parola quando esiste un punto di rottura migliore", () => {
    // A maxWidth=140 il greedy wrap grezzo produce 6 righe con "dire." solo
    // sull'ultima; a -8% (128.8px) la stessa quantità di righe rompe invece su
    // "cosa dire." — verificato empiricamente sulle metriche reali del font.
    const runs = text("Marco guardò il garage vuoto e non seppe cosa dire.");
    const lines = wrapText(runs, font, FONT_SIZE, 140);
    expect(lines).toHaveLength(6);
    const last = lines[lines.length - 1]!.map((t) => t.text).join("");
    expect(last).toBe("cosa dire.");
  });
});
