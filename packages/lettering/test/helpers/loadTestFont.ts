import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFont, type LoadedFont } from "../../src/font.js";

const FONT_PATH = fileURLToPath(
  new URL("../../assets/fonts/ComicNeue-Regular.ttf", import.meta.url),
);

let cached: LoadedFont | undefined;

/** Font reale (OFL-1.1, Comic Neue) usato dai test per la misurazione dei glifi (§8.1). */
export function loadTestFont(): LoadedFont {
  if (!cached) {
    const buffer = readFileSync(FONT_PATH);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    cached = parseFont(arrayBuffer);
  }
  return cached;
}
