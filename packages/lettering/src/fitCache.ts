import type { LoadedFont } from "./font.js";
import { fitBalloonText, type FitBalloonInput, type FitBalloonResult } from "./fitBalloon.js";

/**
 * Re-lettering selettivo (§10.1 passo 4, §8.5).
 *
 * Misurare il testo con i glifi veri è la parte cara del lettering. Il suo
 * risultato dipende solo da testo, corpo, interlinea, padding e spazio
 * disponibile: se nessuno di questi cambia, la misura è la stessa. Dopo una
 * revisione di dodici battute, quindi, si rimisurano dodici battute — non
 * l'episodio. Per chi chiama non cambia nulla: è `fitBalloonText`, con
 * memoria, legata al font (un font diverso misura diverso).
 */
const LIMIT = 20_000;

interface FontCache {
  entries: Map<string, FitBalloonResult>;
  hits: number;
  misses: number;
}

const caches = new WeakMap<LoadedFont, FontCache>();

function cacheFor(font: LoadedFont): FontCache {
  let cache = caches.get(font);
  if (!cache) {
    cache = { entries: new Map(), hits: 0, misses: 0 };
    caches.set(font, cache);
  }
  return cache;
}

/** Arrotondato al centesimo di pixel: sotto quella soglia due spazi sono lo stesso spazio. */
const r = (n: number | undefined) => (n === undefined ? null : Math.round(n * 100) / 100);

function keyOf(input: FitBalloonInput): string {
  return JSON.stringify([
    input.runs.map((run) => [run.t, run.em ?? null]),
    r(input.baseFontSizePx),
    r(input.fontScale),
    r(input.lineHeight),
    r(input.padding),
    r(input.maxWidthPx),
    r(input.maxHeightPx),
    r(input.minFontScale),
    r(input.scaleStep),
    r(input.safetyMarginRatio),
  ]);
}

export function fitBalloonTextCached(input: FitBalloonInput): FitBalloonResult {
  const cache = cacheFor(input.font);
  const key = keyOf(input);
  const hit = cache.entries.get(key);
  if (hit) {
    cache.hits++;
    // Rinfresca la posizione: la cache scarta per prime le misure più vecchie.
    cache.entries.delete(key);
    cache.entries.set(key, hit);
    return hit;
  }
  cache.misses++;
  const result = fitBalloonText(input);
  cache.entries.set(key, result);
  if (cache.entries.size > LIMIT) cache.entries.delete(cache.entries.keys().next().value!);
  return result;
}

/** Quante misure sono state riusate e quante calcolate: per i test e per dire all'utente cosa si è riletterato. */
export function fitCacheStats(font: LoadedFont): { hits: number; misses: number; size: number } {
  const cache = cacheFor(font);
  return { hits: cache.hits, misses: cache.misses, size: cache.entries.size };
}

export function resetFitCache(font: LoadedFont): void {
  caches.delete(font);
}
