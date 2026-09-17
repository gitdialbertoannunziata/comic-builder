import type { PageLayout } from "../schema/page.js";
import type { ReadingDirection } from "../schema/common.js";
import type { PageTemplate, TemplateArea } from "./catalog.js";

export interface ExpandTemplateOptions {
  primaryTarget: string;
  gutter: { x: number; y: number };
  /** `rtl` specchia le colonne: un manga si legge da destra a sinistra (§5.2). */
  readingDirection: ReadingDirection;
}

export interface ExpandedTemplate {
  layout: PageLayout;
  /** Aree nello stesso ordine di `layout.reading_order`, pronte per i pannelli. */
  areas: TemplateArea[];
}

/**
 * Specchia un'area sull'asse verticale della griglia. L'ordine di lettura
 * dichiarato dal template resta lo stesso: una pagina manga non è una pagina
 * occidentale con la sequenza invertita, è la stessa sequenza su un lay-out
 * speculare — ed è il motivo per cui `reading_direction` deve entrare qui e
 * non essere ritoccato a valle.
 */
function mirrorArea(area: TemplateArea, numCols: number): TemplateArea {
  return { ...area, col: numCols - (area.col + area.col_span) };
}

/**
 * Espande un template del catalogo (Appendice B) in un `layout` di pagina più
 * le aree dei pannelli, associate agli id passati. Gli id restano quelli
 * decisi dal chiamante: qui non si generano, perché devono essere stabili e
 * non posizionali (§5.3).
 */
export function expandTemplate(
  template: PageTemplate,
  panelIds: string[],
  options: ExpandTemplateOptions,
): ExpandedTemplate {
  if (panelIds.length !== template.areas.length) {
    throw new Error(
      `Il template "${template.id}" ha ${template.areas.length} aree, ma sono stati passati ${panelIds.length} id di pannello`,
    );
  }

  const numCols = template.cols.length;
  const areas =
    options.readingDirection === "rtl"
      ? template.areas.map((a) => mirrorArea(a, numCols))
      : template.areas.map((a) => ({ ...a }));

  const layout: PageLayout = {
    mode: "page",
    primary_target: options.primaryTarget,
    template_id: template.id,
    cols: [...template.cols],
    rows: [...template.rows],
    gutter: { ...options.gutter },
    reading_order: [...panelIds],
  };

  return { layout, areas };
}
