import { t } from "../i18n.js";
import { useEffect, useState, type KeyboardEvent } from "react";
import { PAGE_TEMPLATES, type Command, type Page, type PageTemplate } from "@comic-builder/core";
import { listArrows, refocus } from "../keyboard.js";

interface Props {
  chapterId: string;
  pages: Page[];
  currentPageId: string;
  sceneId: string;
  onSelectPage: (pageId: string) => void;
  run: (command: Command) => boolean;
  /** Revisioni aperte per pagina: si segnano sulla miniatura. */
  openRevisions?: ReadonlyMap<string, number>;
}

/** Miniatura di un template: le sue aree, nelle proporzioni della pagina. */
export function TemplateThumb({ template }: { template: Pick<PageTemplate, "cols" | "rows" | "areas"> }) {
  const W = 40;
  const H = 60;
  const gap = 2;
  const starts = (weights: number[], size: number) => {
    const total = weights.reduce((a, b) => a + b, 0);
    const out = [0];
    for (const w of weights) out.push(out[out.length - 1]! + (w / total) * size);
    return out;
  };
  const xs = starts(template.cols, W);
  const ys = starts(template.rows, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="template-thumb" aria-hidden>
      {template.areas.map((a, i) => (
        <rect
          key={i}
          x={xs[a.col]! + gap / 2}
          y={ys[a.row]! + gap / 2}
          width={xs[a.col + a.col_span]! - xs[a.col]! - gap}
          height={ys[a.row + a.row_span]! - ys[a.row]! - gap}
        />
      ))}
    </svg>
  );
}

export function PageList({ chapterId, pages, currentPageId, sceneId, onSelectPage, run, openRevisions }: Props) {
  const [picking, setPicking] = useState(false);
  // Gli id presenti prima di un'aggiunta: l'id nuovo lo deriva il Core, e la
  // UI lo scopre al render successivo per selezionare la pagina appena nata.
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const index = pages.findIndex((p) => p.id === currentPageId);

  useEffect(() => {
    if (!before) return;
    const created = pages.find((p) => !before.has(p.id));
    if (created) onSelectPage(created.id);
    setBefore(null);
  }, [pages, before, onSelectPage]);

  function add(templateId: string) {
    const ids = new Set(pages.map((p) => p.id));
    // La pagina nuova va subito dopo quella corrente: è lì che si sta lavorando.
    if (run({ type: "page.add", chapterId, templateId, after: currentPageId, sceneId })) {
      setPicking(false);
      setBefore(ids);
    }
  }

  function move(step: 1 | -1): boolean {
    const to = index + step;
    return to >= 0 && to < pages.length && run({ type: "page.move", pageId: currentPageId, toIndex: to });
  }

  function remove(): boolean {
    const fallback = pages[index + 1] ?? pages[index - 1];
    if (!fallback || !run({ type: "page.remove", pageId: currentPageId })) return false;
    onSelectPage(fallback.id);
    return true;
  }

  /** Sulla miniatura della pagina: frecce per passare alla vicina, Alt+frecce per spostarla, Canc per eliminarla. */
  function onKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-item]")) return;
    const list = event.currentTarget;
    const steps: Record<string, 1 | -1 | undefined> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    const step = event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey ? steps[event.key] : undefined;
    if (step) {
      event.preventDefault();
      if (move(step)) refocus(list, '[aria-pressed="true"]');
    } else if (event.key === "Delete") {
      event.preventDefault();
      if (!event.repeat && remove()) refocus(list, '[aria-pressed="true"]');
    } else {
      listArrows(event);
    }
  }

  return (
    <>
      <div className="pages" onKeyDown={onKeys}>
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="page-chip"
            data-item
            tabIndex={p.id === currentPageId ? 0 : -1}
            aria-pressed={p.id === currentPageId}
            onClick={() => onSelectPage(p.id)}
            title={t("Pagina {0}{1}", p.order, openRevisions?.has(p.id) ? ` · ${openRevisions.get(p.id)} revisioni aperte` : "")}
          >
            {p.layout.mode === "page" && <TemplateThumb template={{ cols: p.layout.cols, rows: p.layout.rows, areas: p.panels.map((x) => x.area) }} />}
            <span>
              {p.order}
              {openRevisions?.has(p.id) && <span className="panel-row__notes"> ✎</span>}
            </span>
          </button>
        ))}
        <button type="button" className="page-chip page-chip--add" aria-expanded={picking} onClick={() => setPicking((v) => !v)} title={t("Aggiungi una pagina")}>
          +
        </button>
      </div>

      {picking && (
        <div className="template-picker">
          <p className="field__hint">{t("Scegli il lay-out della pagina nuova (dopo la")}{" "}{pages[index]?.order ?? t("corrente")}):</p>
          <div className="template-grid">
            {PAGE_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="template-choice" onClick={() => add(t.id)} title={t.usage}>
                <TemplateThumb template={t} />
                <span>{t.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tool-row">
        <button type="button" className="btn btn--small" disabled={index <= 0} onClick={() => move(-1)} title={t("Sposta la pagina prima (Alt+← sulla miniatura)")}>
          {t("← prima")}</button>
        <button type="button" className="btn btn--small" disabled={index >= pages.length - 1} onClick={() => move(1)} title={t("Sposta la pagina dopo (Alt+→ sulla miniatura)")}>
          {t("dopo →")}</button>
        <button type="button" className="btn btn--small" disabled={pages.length <= 1} onClick={remove} title={t("Elimina la pagina (Canc sulla miniatura)")}>
          {t("elimina")}</button>
      </div>
    </>
  );
}
