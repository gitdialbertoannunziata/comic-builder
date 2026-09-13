/** Livelli di lint (Appendice A): errore blocca salvataggio/export, avviso segnala, info suggerisce. */
export type IssueLevel = "error" | "warning" | "info";

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  /** Percorso in stile JSON pointer leggero, es. "panels[2].area". */
  path: string;
}

export function issue(
  level: IssueLevel,
  code: string,
  message: string,
  path: string,
): ValidationIssue {
  return { level, code, message, path };
}
