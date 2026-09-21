/**
 * Derivazione degli id (§5.3). "`ep012-p003-03` è derivabile da episodio,
 * pagina e indice, non un contatore globale."
 *
 * Attenzione a cosa significa "non posizionale": l'id si *deriva* da una
 * coordinata locale e stabile (capitolo, pagina, indice nella pagina) al
 * momento in cui l'elemento nasce, e da lì **non cambia più**. Spostare una
 * pagina dentro il capitolo cambia il suo `order`, non il suo `id` (§5.4:
 * "`order` separato da `id`"). È questa immutabilità che permette al re-run
 * dello script di riconoscere ciò che esisteva già invece di ricrearlo, e
 * quindi di non distruggere le modifiche a mano (§10.3).
 */

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function pageId(chapterId: string, pageNumber: number): string {
  return `${chapterId}-p${pad(pageNumber, 3)}`;
}

export function panelId(pageIdValue: string, indexInPage: number): string {
  return `${pageIdValue}-${pad(indexInPage, 2)}`;
}

export function balloonId(panelIdValue: string, indexInPanel: number): string {
  return `${panelIdValue}-b${indexInPanel}`;
}

export function beatId(sceneIdValue: string, indexInScene: number): string {
  return `${sceneIdValue}-b${indexInScene}`;
}

/**
 * Indice più alto già usato fra gli id esistenti, oppure 0. Si prende il
 * massimo e non il primo buco libero: un id cancellato resta speso.
 * Riempire il buco farebbe puntare una voce di changelog scritta per il
 * vecchio pannello a un pannello nuovo e diverso (§10.2) — il tipo di
 * collisione silenziosa che gli id stabili esistono per evitare.
 */
function highestIndex(existingIds: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const parsed = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(parsed) && parsed > highest) highest = parsed;
  }
  return highest;
}

/**
 * Prossimo indice libero: oltre il più alto presente *e* oltre il più alto mai
 * assegnato (`seq`, salvato nel documento). Il solo massimo dei presenti non
 * basta: cancellato l'ultimo, il successivo ne riprenderebbe l'id.
 */
export function nextIndex(existingIds: readonly string[], prefix: string, seq = 0): number {
  return Math.max(highestIndex(existingIds, prefix), seq) + 1;
}

/** Id per un nuovo pannello in una pagina che ne ha già altri. Non riusa mai un id cancellato. */
export function nextPanelId(pageIdValue: string, existingIds: readonly string[], seq = 0): string {
  return panelId(pageIdValue, nextIndex(existingIds, `${pageIdValue}-`, seq));
}

/** Id per un nuovo balloon in un pannello che ne ha già altri. Stessa regola. */
export function nextBalloonId(panelIdValue: string, existingIds: readonly string[], seq = 0): string {
  return balloonId(panelIdValue, nextIndex(existingIds, `${panelIdValue}-b`, seq));
}

/** L'indice numerico in coda a un id (`ep001-p003-07` → 7), per aggiornare i contatori. */
export function trailingIndex(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}
