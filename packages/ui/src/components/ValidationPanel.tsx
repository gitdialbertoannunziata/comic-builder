import type { ZodIssue } from "zod";
import type { ValidationIssue } from "@comic-builder/core";

interface Props {
  schemaIssues: ZodIssue[];
  docIssues: ValidationIssue[];
  /** Consente di saltare al pannello che l'avviso riguarda, invece di cercarlo a mano. */
  onSelectPanel: (panelId: string) => void;
  knownPanelIds: Set<string>;
}

/**
 * Estrae l'id del pannello dal percorso dell'issue: il lint scrive percorsi
 * come `panels[ep001-p001-03].camera`, e quell'id è ciò che rende l'avviso
 * navigabile invece che solo leggibile.
 */
function panelIdFrom(path: string, known: Set<string>): string | null {
  const match = /panels\[([^\]]+)\]/.exec(path);
  if (match?.[1] && known.has(match[1])) return match[1];

  // Gli issue dello schema usano indici numerici (`panels.2.balloons...`):
  // lì l'id non c'è, e saltare all'indice sbagliato sarebbe peggio di non saltare.
  return null;
}

export function ValidationPanel({ schemaIssues, docIssues, onSelectPanel, knownPanelIds }: Props) {
  const total = schemaIssues.length + docIssues.length;

  if (total === 0) {
    return <p className="all-clear">Nessun problema — documento valido.</p>;
  }

  return (
    <ul className="issues">
      {schemaIssues.map((issue, i) => (
        <li key={`schema-${i}`}>
          <div className="issue issue--error">
            <span className="issue__code">schema</span>
            <span className="issue__text">
              {issue.path.join(".")}: {issue.message}
            </span>
          </div>
        </li>
      ))}

      {docIssues.map((issue, i) => {
        const panelId = panelIdFrom(issue.path, knownPanelIds);
        const className = `issue issue--${issue.level}${panelId ? " issue--clickable" : ""}`;
        const content = (
          <>
            <span className="issue__code">{issue.code}</span>
            <span className="issue__text">{issue.message}</span>
          </>
        );

        return (
          <li key={`doc-${i}`}>
            {panelId ? (
              <button type="button" className={className} onClick={() => onSelectPanel(panelId)}>
                {content}
              </button>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
