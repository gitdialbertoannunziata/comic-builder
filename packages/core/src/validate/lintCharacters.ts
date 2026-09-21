import type { ProjectDoc } from "../document/projectDoc.js";
import { issue, type ValidationIssue } from "./issue.js";

/**
 * Regole sui personaggi (Appendice A, Contenuto).
 *
 * - Costume non specificato per un personaggio che ha varianti: chi disegna
 *   (o il modello) non sa quale abito mettere, e sceglierà a caso.
 * - Costume che la scheda non conosce: di solito un nome scritto diverso
 *   («Notte» invece di «notte»), che nel prompt diventerebbe testo libero.
 * - Personaggio senza scheda: un'informazione, una volta per personaggio.
 *   Senza scheda il suo aspetto è indefinito, e ogni pannello lo reinventa.
 */
export function lintCharacters(doc: ProjectDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const withoutSheet = new Map<string, number>();

  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      for (const character of panel.characters) {
        const sheet = doc.characters[character.ref];
        if (!sheet) {
          withoutSheet.set(character.ref, (withoutSheet.get(character.ref) ?? 0) + 1);
          continue;
        }
        const variants = Object.keys(sheet.wardrobe);
        const path = `pages[${page.id}].panels[${panel.id}].characters[${character.ref}]`;
        if (character.wardrobe === "default" && variants.length > 1 && !sheet.wardrobe.default) {
          issues.push(issue("warning", "content.wardrobe-unspecified", `${panel.id}: quale costume indossa ${character.ref}? (${variants.join(", ")})`, path));
        } else if (character.wardrobe !== "default" && variants.length > 0 && !sheet.wardrobe[character.wardrobe]) {
          issues.push(issue("warning", "content.wardrobe-unknown", `${panel.id}: ${character.ref} indossa «${character.wardrobe}», che la scheda non conosce (${variants.join(", ")})`, path));
        }
      }
    }
  }

  for (const [ref, count] of withoutSheet) {
    issues.push(issue("info", "content.no-character-sheet", `${ref} compare in ${count} pannelli ma non ha una scheda: il suo aspetto non è definito`, `characters[${ref}]`));
  }
  return issues;
}
