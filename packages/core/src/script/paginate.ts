import type { Beat } from "../schema/scenes.js";
import { getTemplate, type PageTemplate } from "../templates/catalog.js";

/**
 * Dimensioni di pagina che lo spoglio può scegliere da solo. Il tetto a 6 non
 * è arbitrario: §6.3 fissa "3–6 pannelli per pagina". `grid-3x3` resta nel
 * catalogo per l'uso manuale, ma nove pannelli non li sceglie l'automatismo.
 * L'1 serve solo come resto (uno splash finale è meglio di una pagina invalida).
 */
const AUTOMATIC_PAGE_SIZES = [6, 4, 3, 1] as const;

interface Plan {
  pages: number;
  splashes: number;
  sizes: number[];
}

/**
 * Divide N beat in pagine usando solo dimensioni che il catalogo sa esprimere.
 * Minimizza il numero di pagine e, a parità, il numero di splash di resto —
 * uno splash è una scelta narrativa forte, non un modo di smaltire un avanzo.
 * Programmazione dinamica: deterministica, nessuna euristica a sentimento.
 */
export function paginateBeats(beatCount: number): number[] {
  if (beatCount <= 0) return [];

  const best: (Plan | null)[] = new Array<Plan | null>(beatCount + 1).fill(null);
  best[0] = { pages: 0, splashes: 0, sizes: [] };

  for (let n = 1; n <= beatCount; n++) {
    for (const size of AUTOMATIC_PAGE_SIZES) {
      if (size > n) continue;
      const previous = best[n - size];
      if (!previous) continue;

      const candidate: Plan = {
        pages: previous.pages + 1,
        splashes: previous.splashes + (size === 1 ? 1 : 0),
        sizes: [...previous.sizes, size],
      };

      const current = best[n];
      const better =
        !current ||
        candidate.pages < current.pages ||
        (candidate.pages === current.pages && candidate.splashes < current.splashes);
      if (better) best[n] = candidate;
    }
  }

  const plan = best[beatCount];
  if (!plan) {
    throw new Error(`Impossibile impaginare ${beatCount} beat con le dimensioni ${AUTOMATIC_PAGE_SIZES.join(", ")}`);
  }

  // Il DP decide *quali* dimensioni, non il loro ordine: l'ordine in cui le
  // accumula è un artefatto della ricorrenza. La regola dichiarata è "pagine
  // piene prima": così un resto da un pannello diventa uno splash di chiusura
  // invece che un'apertura involontaria.
  return [...plan.sizes].sort((a, b) => b - a);
}

/**
 * Sceglie il template per un gruppo di beat. Il modello sceglie *dal catalogo*,
 * non inventa una griglia (§7.3) — e qui la scelta è addirittura derivata dalle
 * funzioni dei beat, quindi verificabile invece che opinabile.
 */
export function chooseTemplate(beats: readonly Beat[]): PageTemplate {
  const count = beats.length;

  const pick = (id: string): PageTemplate => {
    const template = getTemplate(id);
    if (!template) throw new Error(`Template "${id}" assente dal catalogo`);
    return template;
  };

  switch (count) {
    case 1:
      return pick("splash");
    case 3:
      return pick("sidebar-2");
    case 4:
      // "apertura di scena con seguito" se la pagina apre stabilendo il luogo.
      return pick(beats[0]?.function === "establish" ? "top-splash-3" : "t-layout");
    case 6: {
      const dialogue = beats.filter((b) => b.function === "dialogue").length;
      return pick(dialogue * 2 >= count ? "nine-grid-dialogue" : "classic-6");
    }
    case 9:
      return pick("grid-3x3");
    default:
      throw new Error(
        `Nessun template del catalogo accoglie ${count} pannelli: usa paginateBeats per ottenere dimensioni valide`,
      );
  }
}
