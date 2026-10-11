// Genera le icone dell'applicazione: build/icon.png — la sorgente da cui
// electron-builder ricava .ico, .icns e l'icona dell'app — e i quattro tile del
// pacchetto Windows Store in build/appx/. I nomi dei tile sono quelli che
// `AppxManifest.xml` cerca (`StoreLogo.png`, `Square44x44Logo.png`,
// `Square150x150Logo.png`, `Wide310x150Logo.png`): se mancano, electron-builder
// mette i suoi di esempio. Non si ricavano da icon.png, si scrivono qui.
//
// Il disegno è quello del favicon della UI (packages/ui/index.html): una
// nuvoletta di dialogo gialla con il contorno scuro. Qui è lo stesso poligono,
// rasterizzato con sovracampionamento per avere i bordi morbidi. Nessun
// servizio esterno, nessuna dipendenza: `node build/make-icon.mjs`.
//
// icon.png esce con sfondo trasparente (l'icona dell'app); i tile sono opachi,
// sul colore `--bg` della UI, lo stesso di `appx.backgroundColor`: se lo sfondo
// del manifest e quello dell'immagine non coincidono, si vede uno scalino.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPERSAMPLE = 4; // 4×4 campioni per pixel: bordi morbidi senza un tracciatore vettoriale

/** Lo sfondo dei tile: `--bg` di `packages/ui/src/styles.css`, come `appx.backgroundColor`. */
export const PAPER = [0xf6, 0xf3, 0xea];

/**
 * Ogni icona: dove va, quanto è grande, quanto respiro lascia al disegno.
 * `background: null` = sfondo trasparente; altrimenti il disegno è opaco sul
 * colore dato. Le quattro della appx hanno un margine più stretto di icon.png:
 * attorno a un tile Windows non c'è niente da cui prendere respiro.
 */
export const ICONS = [
  { file: "icon.png", width: 1024, height: 1024, margin: 0.1, background: null },
  { file: "appx/StoreLogo.png", width: 50, height: 50, margin: 0.06, background: PAPER },
  { file: "appx/Square44x44Logo.png", width: 44, height: 44, margin: 0.06, background: PAPER },
  { file: "appx/Square150x150Logo.png", width: 150, height: 150, margin: 0.12, background: PAPER },
  { file: "appx/Wide310x150Logo.png", width: 310, height: 150, margin: 0.08, background: PAPER },
];

// Il poligono del favicon, in unità del suo viewBox 0 0 32 32.
const FILL = [0xff, 0xd2, 0x3f]; // #ffd23f
const STROKE = [0x1c, 0x1c, 0x1a]; // #1c1c1a
const STROKE_WIDTH = 2.5; // in unità utente, come nel favicon

const design = [
  [4, 5],
  [28, 5],
  [28, 22],
  [15, 22],
  [8, 28],
  [8, 22],
  [4, 22],
];

const edges = design.map((p, i) => [p, design[(i + 1) % design.length]]);

/** Il disegno vive in un viewBox 32×32: si scala sul lato corto e si centra. */
const VIEW = 32;

function insidePolygon([x, y]) {
  let hit = false;
  for (const [[ax, ay], [bx, by]] of edges) {
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

function distanceToEdge([x, y], [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const halfStroke = STROKE_WIDTH / 2;

/** Il colore di un punto, in unità utente: cioè il contorno, la nuvoletta, o niente. */
function sample(ux, uy) {
  let near = Infinity;
  for (const edge of edges) near = Math.min(near, distanceToEdge([ux, uy], edge));
  if (near <= halfStroke) return STROKE;
  return insidePolygon([ux, uy]) ? FILL : null;
}

export function render(width, height, margin) {
  // Sul lato corto, così un tile largo non stira il disegno; poi si centra.
  const scale = (Math.min(width, height) * (1 - 2 * margin)) / VIEW;
  const offsetX = (width - VIEW * scale) / 2;
  const offsetY = (height - VIEW * scale) / 2;
  const toUser = (px, py) => [(px - offsetX) / scale, (py - offsetY) / scale];
  const raw = Buffer.alloc(height * width * 4); // RGBA, un pixel dopo l'altro: il byte di filtro di ogni riga lo mette png()
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [ux, uy] = toUser(px + (sx + 0.5) / SUPERSAMPLE, py + (sy + 0.5) / SUPERSAMPLE);
          const color = sample(ux, uy);
          if (!color) continue;
          // Media pesata sull'alfa: i pixel di bordo non si scuriscono verso il trasparente.
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      // Alfa = frazione di pixel coperta; i colori si riportano alla loro tinta
      // piena dividendo per il numero di campioni coperti (niente alfa premoltiplicato,
      // così i pixel di bordo restano gialli o neri e non virano verso il trasparente).
      const written = a === 0 ? 0 : Math.round(a / samples);
      const full = a === 0 ? 0 : 255 / a;
      const index = (py * width + px) * 4;
      raw[index] = Math.round(r * full);
      raw[index + 1] = Math.round(g * full);
      raw[index + 2] = Math.round(b * full);
      raw[index + 3] = written;
    }
  }
  return raw;
}

// --- PNG ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function png(width, height, pixels) {
  // Una riga di PNG comincia con il byte di filtro, e qui non si filtra (0):
  // ogni riga è il filtro più i suoi width*4 byte di colore.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Il disegno sopra un colore pieno: i tile sono opachi, così non dipendono da
 * quello che Windows mette dietro (e il colore del manifest resta una nota per
 * chi legge il pacchetto, non qualcosa che si vede).
 */
export function overBackground(pixels, [backR, backG, backB]) {
  const out = Buffer.alloc(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const covered = pixels[i + 3] / 255;
    out[i] = Math.round(backR + (pixels[i] - backR) * covered);
    out[i + 1] = Math.round(backG + (pixels[i + 1] - backG) * covered);
    out[i + 2] = Math.round(backB + (pixels[i + 2] - backB) * covered);
    out[i + 3] = 255;
  }
  return out;
}

const root = path.dirname(fileURLToPath(import.meta.url));

/** Scrive tutte le icone accanto a questo script. */
export function writeIcons() {
  for (const { file, width, height, margin, background } of ICONS) {
    const pixels = render(width, height, margin);
    const out = path.join(root, file);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, png(width, height, background ? overBackground(pixels, background) : pixels));
    console.log(`${file} scritto: ${width}×${height}`);
  }
}

// Importato — da un test — questo modulo non deve scrivere niente: le icone si
// generano solo eseguendolo.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) writeIcons();
