import type { ZodIssue } from "zod";
import type { ValidationIssue } from "@comic-builder/core";

interface Props {
  schemaIssues: ZodIssue[];
  docIssues: ValidationIssue[];
}

const LEVEL_COLOR: Record<string, string> = {
  error: "#b3261e",
  warning: "#8a6100",
  info: "#3a5a99",
};

const LEVEL_BG: Record<string, string> = {
  error: "#fdecea",
  warning: "#fff6df",
  info: "#eaf1fb",
};

/**
 * Stessa funzione di validazione degli altri due ingressi — output del
 * modello e apertura file (§7.1): qui applicata al documento modificato a
 * mano. Gli issue dello schema (parse fallito, es. un'ancora fuori [0,1])
 * sono sempre "errore"; quelli di validateDocument portano il proprio livello.
 */
export function ValidationPanel({ schemaIssues, docIssues }: Props) {
  const total = schemaIssues.length + docIssues.length;

  if (total === 0) {
    return <p style={{ color: "#2f8f5b", fontSize: 13 }}>Nessun problema — documento valido.</p>;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {schemaIssues.map((issue, i) => (
        <li
          key={`schema-${i}`}
          style={{
            background: LEVEL_BG.error,
            color: LEVEL_COLOR.error,
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12.5,
          }}
        >
          <strong>schema</strong> — {issue.path.join(".")}: {issue.message}
        </li>
      ))}
      {docIssues.map((issue, i) => (
        <li
          key={`doc-${i}`}
          style={{
            background: LEVEL_BG[issue.level],
            color: LEVEL_COLOR[issue.level],
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12.5,
          }}
        >
          <strong>{issue.level}</strong> — {issue.code}: {issue.message}
        </li>
      ))}
    </ul>
  );
}
