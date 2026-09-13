import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFont, type LoadedFont } from "./font.js";

const FONT_PATH = fileURLToPath(new URL("../assets/fonts/ComicNeue-Regular.ttf", import.meta.url));

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
