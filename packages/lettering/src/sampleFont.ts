import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFont, type LoadedFont } from "./font.js";

const FONT_PATH = fileURLToPath(new URL("../assets/fonts/ComicNeue-Regular.ttf", import.meta.url));

/**
 * Percorso del file del font, non solo il font già letto: chi rasterizza
 * (resvg, §export) deve ricevere *il file*, altrimenti misura con Comic Neue
 * e disegna con un font di sistema qualsiasi — e le due larghezze non
 * coincidono. Era esattamente il baco che faceva sbordare il testo dai
 * pannelli prima che questo percorso venisse esposto.
 */
export const sampleFontPath = FONT_PATH;

/** Nome della famiglia come va dichiarato in `font-family` dell'SVG. */
export const sampleFontFamily = "Comic Neue";

let cached: LoadedFont | undefined;

/**
 * Font di sviluppo/test (Comic Neue, OFL-1.1 — licenza in assets/fonts/NOTICE.md).
 * Serve a esercitare la misurazione reale dei glifi in test e demo; non è la
 * decisione sul font di default dei nuovi progetti (§14.8 del piano, ancora aperta).
 */
export function loadSampleFont(): LoadedFont {
  if (!cached) {
    const buffer = readFileSync(FONT_PATH);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    cached = parseFont(arrayBuffer);
  }
  return cached;
}
