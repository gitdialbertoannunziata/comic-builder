// I tile della appx non sono disegno da guardare: sono quello che lo Store
// mostra al posto del nome, e Windows li cerca per nome esatto. Se mancano,
// electron-builder mette i suoi di esempio e il pacchetto resta anonimo: qui si
// controlla quello che si può controllare senza aprire un PNG — nomi e misure,
// poi che i file siano PNG leggibili, opachi sul colore del manifest, con il
// disegno centrato (un tile largo non deve stirare la nuvoletta).

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ICONS, PAPER, overBackground, png, render } from "../build/make-icon.mjs";

/** Le icone dichiarate: file, misura, e se sono opache (tile) o trasparenti (icona dell'app). */
const DECLARED = [
  ["icon.png", 1024, 1024, false],
  ["appx/StoreLogo.png", 50, 50, true],
  ["appx/Square44x44Logo.png", 44, 44, true],
  ["appx/Square150x150Logo.png", 150, 150, true],
  ["appx/Wide310x150Logo.png", 310, 150, true],
];

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Legge un PNG come lo scrive lo script: firma, un IHDR, un IDAT, la fine; ogni
 * riga comincia col byte di filtro, che qui è sempre 0. Restituisce i pixel RGBA
 * senza le righe, cioè quello che nel file non c'è.
 */
function decode(buffer) {
  expect([...buffer.subarray(0, 8)]).toEqual(SIGNATURE);
  const parts = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    parts.push({ type: buffer.toString("ascii", at + 4, at + 8), data: buffer.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  expect(parts.map((part) => part.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  expect(parts[2].data.length).toBe(0);
  const header = parts[0].data;
  expect(header.toString("hex", 8)).toBe("0806000000"); // 8 bit per canale, RGBA, senza interlace
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const stride = width * 4 + 1;
  const raw = inflateSync(parts[1].data);
  expect(raw.length).toBe(height * stride);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0);
    raw.copy(pixels, y * width * 4, y * stride + 1, y * stride + stride);
  }
  return { width, height, pixels };
}

function pixel({ width, pixels }, x, y) {
  return [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

/** Il rettangolo occupato dal disegno su un tile: quello che resta è il colore di fondo. */
function drawing({ width, height, pixels }) {
  const box = { left: width, right: -1, top: height, bottom: -1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel({ width, pixels }, x, y);
      if (r === PAPER[0] && g === PAPER[1] && b === PAPER[2]) continue;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return { ...box, width: box.right - box.left + 1, height: box.bottom - box.top + 1 };
}

/**
 * I pixel di un tile, disegnati una volta sola: sono poche decine di migliaia.
 * icon.png no — 1024² sono cinque secondi — e non serve: il suo disegno è lo
 * stesso codice, la misura vera la controlla il primo test, e il margine
 * trasparente si vede già a 128 pixel.
 */
const tiles = new Map();
function tile(file) {
  if (!tiles.has(file)) {
    const icon = ICONS.find((one) => one.file === file);
    const pixels = overBackground(render(icon.width, icon.height, icon.margin), icon.background);
    tiles.set(file, decode(png(icon.width, icon.height, pixels)));
  }
  return tiles.get(file);
}

describe("Icone", () => {
  it("i tile hanno i nomi e le misure che Windows pretende", () => {
    expect(ICONS.map(({ file, width, height, background }) => [file, width, height, background !== null])).toEqual(DECLARED);
  });

  it("i tile sono opachi sul colore del manifest, e ne escono PNG leggibili", () => {
    for (const [file, width = 0, height = 0, opaque] of DECLARED) {
      if (!opaque) continue;
      const image = tile(file);
      expect([image.width, image.height]).toEqual([width, height]);
      expect(pixel(image, 0, 0)).toEqual([...PAPER, 255]);
      expect(pixel(image, width - 1, height - 1)).toEqual([...PAPER, 255]);
      let thinnest = 255;
      for (let i = 3; i < image.pixels.length; i += 4) thinnest = Math.min(thinnest, image.pixels[i]);
      expect(thinnest).toBe(255);
    }
  });

  it("il disegno sono pixel RGBA densi: i byte di filtro del PNG li mette png()", () => {
    // Se il disegno portasse già i byte di filtro, `overBackground` li
    // dipingerebbe con lo sfondo e il tile uscirebbe un PNG illeggibile
    // (tipo di filtro 246): è lo scambio da non rifare.
    expect(render(5, 5, 0.06).length).toBe(5 * 5 * 4);
  });

  it("l'icona dell'app ha il margine trasparente e il centro disegnato", () => {
    const { margin } = ICONS.find((one) => one.file === "icon.png");
    const image = decode(png(128, 128, render(128, 128, margin)));
    expect(pixel(image, 0, 0)[3]).toBe(0);
    expect(pixel(image, 127, 127)[3]).toBe(0);
    expect(pixel(image, 64, 64)[3]).toBe(255);
  });

  it("un tile largo non stira il disegno, e lo tiene al centro", () => {
    const wide = drawing(tile("appx/Wide310x150Logo.png"));
    // Scalato sul lato lungo, il disegno verrebbe largo 260 pixel invece di 105.
    expect(Math.abs(wide.width - wide.height)).toBeLessThan(0.1 * wide.height);
    // E in mezzo: i due margini orizzontali sono uguali a meno dell'antialiasing.
    expect(Math.abs(wide.left - (309 - wide.right))).toBeLessThanOrEqual(1);
  });
});
