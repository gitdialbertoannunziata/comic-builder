import * as opentypeNamespace from "opentype.js";

/**
 * opentype.js si presenta diversamente a seconda di chi lo carica: sotto Node
 * (interop CJS) l'intera API finisce dentro `.default`; sotto un bundler per
 * browser (Vite/Rollup usa la build .mjs vera) `.default` non esiste e l'API
 * è già ai livelli superiori del modulo. Verificato costruendo entrambi
 * (`vitest` in Node, `vite build` per il pacchetto ui) — nessuno dei due stili
 * di import da solo funziona in entrambi gli ambienti.
 */
type OpentypeModule = typeof opentypeNamespace;
const opentype: OpentypeModule =
  (opentypeNamespace as OpentypeModule & { default?: OpentypeModule }).default ?? opentypeNamespace;

export type LoadedFont = InstanceType<OpentypeModule["Font"]>;

/**
 * Fa il parsing di un font già in memoria. Non tocca il filesystem: chi chiama
 * (CLI, editor, test) legge i byte e li passa qui — coerente con l'idea che
 * l'I/O vive nei servizi/host, non nella libreria di misurazione.
 */
export function parseFont(buffer: ArrayBuffer): LoadedFont {
  return opentype.parse(buffer);
}
