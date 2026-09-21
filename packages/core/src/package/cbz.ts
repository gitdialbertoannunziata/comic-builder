import { createZip, utf8, type ZipEntry } from "./zip.js";

/**
 * CBZ (Appendice C): archivio di immagini "con numerazione di pagina per
 * ordine di lettura". Contenitore neutro per consegne e backup.
 *
 * Dentro, oltre alle immagini, un `ComicInfo.xml`: non è uno standard formale
 * ma è quello che leggono di fatto i lettori (Komga, Kavita, CDisplayEx,
 * Panels…). È lì che si dice a un lettore che il fumetto va letto da destra a
 * sinistra — senza, un manga in CBZ si sfoglia al contrario.
 */
export interface CbzImage {
  /** Nome già ordinato secondo la lettura (vedi `pageFileNames`). */
  name: string;
  data: Uint8Array;
}

export interface CbzInfo {
  title: string;
  series?: string;
  number?: string;
  /** Codice lingua ISO (it, en…), dal `locale` del progetto. */
  languageIso?: string;
  readingDirection: "ltr" | "rtl";
  /** Data fissa dei file nell'archivio: rende l'export riproducibile. */
  modified?: Date;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function comicInfoXml(info: CbzInfo, pageCount: number): string {
  const field = (tag: string, value: string | undefined) =>
    value === undefined || value === "" ? "" : `  <${tag}>${escapeXml(value)}</${tag}>\n`;
  const pages = Array.from({ length: pageCount }, (_, i) => `    <Page Image="${i}"${i === 0 ? ' Type="FrontCover"' : ""}/>`).join("\n");

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    field("Title", info.title) +
    field("Series", info.series) +
    field("Number", info.number) +
    field("LanguageISO", info.languageIso) +
    field("PageCount", String(pageCount)) +
    // `YesAndRightToLeft` è il valore che i lettori usano per invertire il verso.
    field("Manga", info.readingDirection === "rtl" ? "YesAndRightToLeft" : "No") +
    `  <Pages>\n${pages}\n  </Pages>\n` +
    `</ComicInfo>\n`
  );
}

export function createCbz(images: readonly CbzImage[], info: CbzInfo): Uint8Array {
  // Ordine dell'archivio = ordine di lettura: molti lettori ignorano ComicInfo
  // e ordinano per nome, quindi i nomi devono già essere nell'ordine giusto.
  const sorted = [...images].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const entries: ZipEntry[] = [
    ...sorted.map((image) => ({ name: image.name, data: image.data })),
    { name: "ComicInfo.xml", data: utf8(comicInfoXml(info, sorted.length)) },
  ];
  return createZip(entries, info.modified);
}
