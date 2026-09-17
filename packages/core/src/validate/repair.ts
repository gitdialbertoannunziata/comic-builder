import type { Page } from "../schema/page.js";
import { issue, type ValidationIssue } from "./issue.js";

/**
 * Riparazione deterministica del documento (§12, F1: "validazione e riparazione").
 *
 * Ripara solo ciò che ha **una** risposta ovvia. Un ordine di lettura a cui
 * manca un pannello si completa in un modo solo sensato; un buco nella griglia
 * no — quale pannello dovrebbe crescere per coprirlo? Quelli restano errori
 * per una persona, perché indovinare sarebbe peggio che fermarsi.
 *
 * Serve a due ingressi diversi: l'output del modello (che può arrivare
 * incompleto anche col decoding vincolato) e il merge dei re-run, dove un
 * pannello nuovo può finire fuori da un ordine di lettura ritoccato a mano.
 */

export interface RepairResult {
  page: Page;
  /** Cosa è stato riparato, da mostrare: una riparazione silenziosa è una sorpresa. */
  repairs: ValidationIssue[];
}

export function repairPage(input: Page): RepairResult {
  const repairs: ValidationIssue[] = [];
  const page: Page = { ...input };
  const panelIds = page.panels.map((p) => p.id);
  const known = new Set(panelIds);

  // Span che escono dalla griglia: si accorciano fino al bordo. La posizione
  // dichiarata dall'autore resta, l'eccedenza no.
  if (page.layout.mode === "page") {
    const numCols = page.layout.cols.length;
    const numRows = page.layout.rows.length;

    page.panels = page.panels.map((panel) => {
      const maxColSpan = Math.max(1, numCols - panel.area.col);
      const maxRowSpan = Math.max(1, numRows - panel.area.row);
      if (panel.area.col_span <= maxColSpan && panel.area.row_span <= maxRowSpan) return panel;

      repairs.push(
        issue(
          "info",
          "repair.span-clamped",
          `Span del pannello "${panel.id}" ridotto a ${Math.min(panel.area.col_span, maxColSpan)}x${Math.min(panel.area.row_span, maxRowSpan)} per rientrare nella griglia ${numCols}x${numRows}`,
          `panels[${panel.id}].area`,
        ),
      );
      return {
        ...panel,
        area: {
          ...panel.area,
          col_span: Math.min(panel.area.col_span, maxColSpan),
          row_span: Math.min(panel.area.row_span, maxRowSpan),
        },
      };
    });
  }

  // Ordine di lettura: deve essere una permutazione completa dei pannelli.
  const currentOrder = page.layout.mode === "page" ? page.layout.reading_order : page.layout.sequence;
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const id of currentOrder) {
    if (!known.has(id)) {
      repairs.push(
        issue("info", "repair.order-stale-id", `Rimosso dall'ordine di lettura un id inesistente: "${id}"`, "layout"),
      );
      continue;
    }
    if (seen.has(id)) {
      repairs.push(
        issue("info", "repair.order-duplicate", `Rimosso un id duplicato dall'ordine di lettura: "${id}"`, "layout"),
      );
      continue;
    }
    seen.add(id);
    kept.push(id);
  }

  // I pannelli assenti si accodano nell'ordine in cui stanno nel documento:
  // è l'unica scelta che non inventa un'intenzione di regia.
  const missing = panelIds.filter((id) => !seen.has(id));
  for (const id of missing) {
    repairs.push(
      issue("info", "repair.order-appended", `Pannello "${id}" accodato all'ordine di lettura`, "layout"),
    );
  }
  const repairedOrder = [...kept, ...missing];

  if (repairedOrder.length !== currentOrder.length || repairedOrder.some((id, i) => id !== currentOrder[i])) {
    page.layout =
      page.layout.mode === "page"
        ? { ...page.layout, reading_order: repairedOrder }
        : { ...page.layout, sequence: repairedOrder };
  }

  return { page, repairs };
}
