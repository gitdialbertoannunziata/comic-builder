import type { Page } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import { issue, type ValidationIssue } from "./issue.js";

/**
 * Una sola funzione di validazione condivisa fra output del modello, apertura file
 * ed edit della UI (§7.1): la difesa più economica contro documenti incoerenti,
 * qualunque sia la loro provenienza.
 */
export function validateDocument(page: Page): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (page.layout.mode === "page") {
    issues.push(...validatePageTiling(page, page.layout.cols.length, page.layout.rows.length));
    issues.push(...validateReadingOrder(page.panels, page.layout.reading_order, "layout.reading_order"));
  } else {
    issues.push(...validateReadingOrder(page.panels, page.layout.sequence, "layout.sequence"));
  }

  return issues;
}

function validatePageTiling(page: Page, numCols: number, numRows: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const occupants = new Map<string, Array<{ panel: Panel; z: number }>>();

  page.panels.forEach((panel, index) => {
    const { col, row, col_span, row_span, z } = panel.area;
    const path = `panels[${index}].area`;

    if (col + col_span > numCols || row + row_span > numRows) {
      issues.push(
        issue(
          "error",
          "grid.span-out-of-bounds",
          `Il pannello "${panel.id}" ha uno span (${col_span}x${row_span} da col=${col},row=${row}) che eccede la griglia ${numCols}x${numRows}`,
          path,
        ),
      );
      return;
    }

    for (let r = row; r < row + row_span; r++) {
      for (let c = col; c < col + col_span; c++) {
        const key = `${c},${r}`;
        const cell = occupants.get(key) ?? [];
        cell.push({ panel, z });
        occupants.set(key, cell);
      }
    }
  });

  const holes: string[] = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const key = `${c},${r}`;
      const cell = occupants.get(key);
      if (!cell || cell.length === 0) {
        holes.push(key);
        continue;
      }
      if (cell.length > 1) {
        const allDefaultZ = cell.every((o) => o.z === 0);
        if (allDefaultZ) {
          const ids = cell.map((o) => o.panel.id).join(", ");
          issues.push(
            issue(
              "error",
              "grid.overlap-undeclared",
              `Sovrapposizione non dichiarata in col=${c},row=${r} fra i pannelli: ${ids} (nessuno dichiara un "z" esplicito per l'inset)`,
              "panels",
            ),
          );
        }
      }
    }
  }

  if (holes.length > 0) {
    issues.push(
      issue(
        "error",
        "grid.hole",
        `La griglia ha ${holes.length} cella/e non coperte da alcun pannello: ${holes.join("; ")}`,
        "layout",
      ),
    );
  }

  return issues;
}

function validateReadingOrder(
  panels: Panel[],
  order: string[],
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const panelIds = new Set(panels.map((p) => p.id));

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown: string[] = [];

  for (const id of order) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    if (!panelIds.has(id)) unknown.push(id);
  }

  const missing = [...panelIds].filter((id) => !seen.has(id));

  if (duplicates.size > 0) {
    issues.push(
      issue("error", "order.duplicate", `Id duplicati: ${[...duplicates].join(", ")}`, path),
    );
  }
  if (unknown.length > 0) {
    issues.push(
      issue("error", "order.unknown-id", `Id di pannelli inesistenti: ${unknown.join(", ")}`, path),
    );
  }
  if (missing.length > 0) {
    issues.push(
      issue(
        "error",
        "order.incomplete",
        `Pannelli assenti dall'ordine di lettura: ${missing.join(", ")}`,
        path,
      ),
    );
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
