import { describe, expect, it } from "vitest";
import { fitBalloonText } from "../src/fitBalloon.js";
import { loadTestFont } from "./helpers/loadTestFont.js";

const font = loadTestFont();

const PARAGRAPH = [
  {
    t: "Non c'è più niente qui dentro, pensò Marco guardando il garage vuoto e polveroso, con la porta basculante ancora aperta alle sue spalle.",
  },
];

function baseInput(overrides: Partial<Parameters<typeof fitBalloonText>[0]> = {}) {
  return {
    runs: PARAGRAPH,
    font,
    baseFontSizePx: 26,
    fontScale: 1.0,
    lineHeight: 1.35,
    padding: 12,
    maxWidthPx: 300,
    maxHeightPx: 300,
    ...overrides,
  };
}

describe("fitBalloonText (§8.1)", () => {
  it("non riduce font_scale se il testo entra nello spazio disponibile", () => {
    const result = fitBalloonText(baseInput({ maxHeightPx: 300 }));
    expect(result.fontScale).toBe(1.0);
    expect(result.fits).toBe(true);
    expect(result.balloonHeight).toBeLessThanOrEqual(300);
  });

  it("riduce font_scale a step di 0.05 finché il testo non entra", () => {
    const result = fitBalloonText(baseInput({ maxHeightPx: 160 }));
    expect(result.fontScale).toBeLessThan(1.0);
    expect(result.fontScale).toBeGreaterThan(0.6);
    // Scala raggiunta con step da 0.05 a partire da 1.0 (a meno di errori di arrotondamento float).
    expect(Math.round((1.0 - result.fontScale) / 0.05)).toBeCloseTo((1.0 - result.fontScale) / 0.05, 3);
    expect(result.fits).toBe(true);
    expect(result.balloonHeight).toBeLessThanOrEqual(160);
    expect(result.fontSizePx).toBeCloseTo(26 * result.fontScale, 5);
  });

  it("segnala fits:false quando il testo non entra nemmeno a font_scale minima — mai testo che esce dal balloon senza avviso", () => {
    const result = fitBalloonText(baseInput({ maxHeightPx: 50 }));
    expect(result.fontScale).toBe(0.6);
    expect(result.fits).toBe(false);
  });

  it("rispetta un minFontScale personalizzato", () => {
    const result = fitBalloonText(baseInput({ maxHeightPx: 50, minFontScale: 0.4 }));
    expect(result.fontScale).toBe(0.4);
  });

  it("balloonWidth e balloonHeight includono padding e margine di sicurezza su entrambi i lati", () => {
    const result = fitBalloonText(baseInput({ maxHeightPx: 300, padding: 20 }));
    // Margine di sicurezza = fontSizePx * 0.15 per lato (oltre al padding), vedi
    // renderSafetyMarginPx in fitBalloon.ts: assorbe lo scarto fra la misurazione
    // a riga intera e il render spezzato in più <tspan> ai confini dell'enfasi.
    const margin = result.fontSizePx * 0.15;
    const inset = (20 + margin) * 2;
    expect(result.balloonWidth).toBeCloseTo(result.blockWidth + inset, 5);
    expect(result.balloonHeight).toBeCloseTo(result.blockHeight + inset, 5);
  });
});
