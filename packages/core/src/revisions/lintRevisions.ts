import type { ProjectDoc } from "../document/projectDoc.js";
import { issue, type ValidationIssue } from "../validate/issue.js";
import { locate } from "./revisionCommands.js";

/**
 * Regole di produzione sul changelog (Appendice A).
 *
 * `balloon.rev` più vecchio dell'ultima voce applicata che lo riguarda vuol
 * dire che il documento non contiene la correzione che il changelog dice
 * applicata: di solito un file di pagina rimesso da un backup, o modificato
 * a mano fuori dallo strumento. Un balloon da riletterare, e non lo si vede
 * a occhio.
 */
export function lintRevisions(doc: ProjectDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [chapterId, revs] of Object.entries(doc.revisions)) {
    const latest = new Map<string, number>();
    for (const entry of revs.entries) {
      if (entry.status === "applied" && entry.balloon && entry.rev !== null) {
        latest.set(entry.balloon, Math.max(latest.get(entry.balloon) ?? 0, entry.rev));
      }
    }
    for (const [balloonId, rev] of latest) {
      const found = locate(doc, { panel: null, balloon: balloonId });
      if (found?.balloon && found.balloon.rev < rev) {
        issues.push(
          issue("warning", "production.stale-rev", `${balloonId}: rev ${found.balloon.rev}, ma il changelog registra una correzione applicata alla rev ${rev}`, `revisions[${chapterId}].${balloonId}`),
        );
      }
    }
    for (const entry of revs.entries) {
      if (entry.status !== "open" || entry.kind === "note") continue;
      if (!locate(doc, entry)) {
        issues.push(issue("warning", "revision.orphan", `${entry.id}: ${entry.balloon ?? entry.panel} non esiste più`, `revisions[${chapterId}].${entry.id}`));
      }
    }
  }
  return issues;
}
