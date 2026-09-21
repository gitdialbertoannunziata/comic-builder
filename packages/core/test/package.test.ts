import { describe, expect, it } from "vitest";
import { createZip, crc32, utf8 } from "../src/package/zip.js";
import { comicInfoXml, createCbz } from "../src/package/cbz.js";

/** Legge la directory centrale: ciò che un lettore CBZ guarda per primo. */
function readZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength;
    out.push({ name, data: bytes.slice(start, start + size), crc });
    at += 46 + nameLength;
  }
  return out;
}

describe("zip STORE", () => {
  it("CRC-32 standard", () => {
    expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
  });

  it("utf8 coincide con TextEncoder, accenti ed emoji compresi", () => {
    const text = "Capo Vento — «faro» è spento 🌊";
    expect(utf8(text)).toEqual(new TextEncoder().encode(text));
  });

  it("si rilegge: nomi, contenuti e CRC", () => {
    const entries = [
      { name: "001-p1.png", data: Uint8Array.from([1, 2, 3]) },
      { name: "cartella/è.txt", data: utf8("ciao") },
    ];
    const read = readZip(createZip(entries));
    expect(read.map((e) => e.name)).toEqual(["001-p1.png", "cartella/è.txt"]);
    expect(read[1]!.data).toEqual(utf8("ciao"));
    expect(read[0]!.crc).toBe(crc32(entries[0]!.data));
  });

  it("è deterministico: stesso contenuto, stessi byte", () => {
    const entries = [{ name: "a", data: utf8("x") }];
    expect(createZip(entries)).toEqual(createZip(entries));
  });
});

describe("CBZ", () => {
  it("immagini in ordine di lettura e ComicInfo.xml in coda", () => {
    const cbz = createCbz(
      [
        { name: "010-p10.png", data: utf8("10") },
        { name: "002-p2.png", data: utf8("2") },
      ],
      { title: "Capitolo 1", readingDirection: "ltr" },
    );
    expect(readZip(cbz).map((e) => e.name)).toEqual(["002-p2.png", "010-p10.png", "ComicInfo.xml"]);
  });

  it("un fumetto da destra a sinistra lo dichiara ai lettori", () => {
    expect(comicInfoXml({ title: "t", readingDirection: "rtl" }, 3)).toContain("<Manga>YesAndRightToLeft</Manga>");
    expect(comicInfoXml({ title: "t", readingDirection: "ltr" }, 3)).toContain("<Manga>No</Manga>");
  });

  it("scappa i caratteri XML del titolo", () => {
    expect(comicInfoXml({ title: "A & B <1>", readingDirection: "ltr" }, 1)).toContain("<Title>A &amp; B &lt;1&gt;</Title>");
  });
});
