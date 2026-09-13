import opentype from "opentype.js";

export type LoadedFont = opentype.Font;

/**
 * Fa il parsing di un font già in memoria. Non tocca il filesystem: chi chiama
 * (CLI, editor, test) legge i byte e li passa qui — coerente con l'idea che
 * l'I/O vive nei servizi/host, non nella libreria di misurazione.
 */
export function parseFont(buffer: ArrayBuffer): LoadedFont {
  return opentype.parse(buffer);
}
