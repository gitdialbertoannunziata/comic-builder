import type { Page } from "../schema/page.js";

/**
 * Nomi dei file esportati (Appendice C, regola 1): "l'ordine di lettura è
 * quello del documento, non l'ordine di file system: i nomi dei file esportati
 * devono seguire `reading_order`".
 *
 * Da qui il prefisso numerico: senza, un capitolo di dodici pagine si ordina
 * `p1, p10, p11, p12, p2…` in qualunque cartella, e chi riceve l'archivio
 * legge le pagine nell'ordine sbagliato. Il prefisso viene da `page.order`,
 * non dalla posizione nell'array, perché è `order` a portare la sequenza nel
 * capitolo (§5.4: "`order` separato da `id`").
 */
export function pageFileName(page: Page, extension: string): string {
  return `${String(page.order).padStart(3, "0")}-${page.id}.${extension}`;
}

export function documentFileName(page: Page): string {
  return pageFileName(page, "json");
}

/** Larghezza del prefisso scelta sul capitolo più lungo, così l'ordinamento regge anche oltre le 999 pagine. */
export function pageFileNames(pages: readonly Page[], extension: string): string[] {
  const width = Math.max(3, String(Math.max(...pages.map((p) => p.order), 0)).length);
  return pages.map((page) => `${String(page.order).padStart(width, "0")}-${page.id}.${extension}`);
}
