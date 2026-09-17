/**
 * Catalogo dei template di pagina (Appendice B del piano).
 *
 * Ogni template è una tupla deterministica `{cols, rows, areas[]}`: le aree
 * sono dichiarate **nell'ordine di lettura**, non nell'ordine in cui capita di
 * disegnarle ("`reading_order` è parte del template, non un effetto collaterale
 * del disegno"). Le aree tassellano sempre la griglia — un template che non lo
 * facesse non entrerebbe nel catalogo, ed è verificato da un test che passa
 * ogni template del catalogo per `validateDocument` (§7.1).
 */

export interface TemplateArea {
  col: number;
  row: number;
  col_span: number;
  row_span: number;
}

export interface PageTemplate {
  id: string;
  /** Pesi `fr` delle tracce (§7.1): i px si calcolano solo nel renderer. */
  cols: number[];
  rows: number[];
  /** In ordine di lettura, per una pagina `ltr`. Per `rtl` si specchia (vedi expandTemplate). */
  areas: TemplateArea[];
  /** Nota d'uso dell'Appendice B, utile all'editor e al prompt del modello (§7.3: il modello sceglie dal catalogo). */
  usage: string;
}

function area(col: number, row: number, col_span = 1, row_span = 1): TemplateArea {
  return { col, row, col_span, row_span };
}

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: "splash",
    cols: [1],
    rows: [1],
    areas: [area(0, 0)],
    usage: "pagina di apertura, momento forte",
  },
  {
    id: "grid-3x3",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    areas: [
      area(0, 0), area(1, 0), area(2, 0),
      area(0, 1), area(1, 1), area(2, 1),
      area(0, 2), area(1, 2), area(2, 2),
    ],
    usage: "ritmo serrato, sequenze di azione",
  },
  {
    id: "nine-grid-dialogue",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    // Tre scambi rapidi in alto, poi una colonna alta a sinistra che tiene il
    // tempo lungo mentre il dialogo prosegue a destra.
    areas: [
      area(0, 0), area(1, 0), area(2, 0),
      area(0, 1, 1, 2),
      area(1, 1, 2, 1),
      area(1, 2, 2, 1),
    ],
    usage: "dialoghi fitti, tempi lunghi",
  },
  {
    id: "classic-6",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    // Alternanza 1/3 + 2/3 riga per riga.
    areas: [
      area(0, 0), area(1, 0, 2, 1),
      area(0, 1, 2, 1), area(2, 1),
      area(0, 2), area(1, 2, 2, 1),
    ],
    usage: "pagina di dialogo standard",
  },
  {
    id: "top-splash-3",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    // Fascia a tutta larghezza in alto, tre pannelli alti sotto.
    areas: [
      area(0, 0, 3, 1),
      area(0, 1, 1, 2), area(1, 1, 1, 2), area(2, 1, 1, 2),
    ],
    usage: "apertura di scena con seguito",
  },
  {
    id: "t-layout",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    // Fascia alta a tutta larghezza, due pannelli a sinistra, una colonna alta
    // a destra che scende di due righe.
    areas: [
      area(0, 0, 3, 1),
      area(0, 1, 2, 1),
      area(2, 1, 1, 2),
      area(0, 2, 2, 1),
    ],
    usage: "pagina con gerarchia di lettura forte (manga)",
  },
  {
    id: "sidebar-2",
    cols: [1, 1, 1],
    rows: [1, 1, 1],
    // Colonna stretta alta a sinistra, due pannelli nel resto.
    areas: [
      area(0, 0, 1, 3),
      area(1, 0, 2, 2),
      area(1, 2, 2, 1),
    ],
    usage: "reazioni laterali, commento visivo",
  },
  {
    id: "strip-4",
    cols: [1],
    rows: [1, 1, 1, 1],
    areas: [area(0, 0), area(0, 1), area(0, 2), area(0, 3)],
    usage: "striscia webtoon, oppure pagina di montaggio",
  },
] as const;

export function getTemplate(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}

/** Quanti pannelli servono per riempire un template: il modello sceglie in base al numero di beat (§7.3). */
export function templatePanelCount(template: PageTemplate): number {
  return template.areas.length;
}

/**
 * Template che accolgono esattamente `count` pannelli, ordinati come nel
 * catalogo. Serve alla scelta deterministica a valle dello spoglio: il modello
 * sceglie *dal catalogo*, non inventa una griglia (§7.3).
 */
export function templatesForPanelCount(count: number): PageTemplate[] {
  return PAGE_TEMPLATES.filter((t) => t.areas.length === count);
}
