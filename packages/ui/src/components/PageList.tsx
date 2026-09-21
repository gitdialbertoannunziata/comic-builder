import { useEffect, useState } from "react";
import { PAGE_TEMPLATES, type Command, type Page, type PageTemplate } from "@comic-builder/core";

interface Props {
  chapterId: string;
  pages: Page[];
  currentPageId: string;
  sceneId: string;
  onSelectPage: (pageId: string) => void;
  run: (command: Command) => boolean;
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

export function PageList({ chapterId, pages, currentPageId, sceneId, onSelectPage, run }: Props) {
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

  return (
    <>
      <div className="pages">
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="page-chip"
            aria-pressed={p.id === currentPageId}
            onClick={() => onSelectPage(p.id)}
            title={`Pagina ${p.order}`}
          >
            {p.layout.mode === "page" && <TemplateThumb template={{ cols: p.layout.cols, rows: p.layout.rows, areas: p.panels.map((x) => x.area) }} />}
            <span>{p.order}</span>
          </button>
        ))}
        <button type="button" className="page-chip page-chip--add" aria-expanded={picking} onClick={() => setPicking((v) => !v)} title="Aggiungi una pagina">
          +
        </button>
      </div>

      {picking && (
        <div className="template-picker">
          <p className="field__hint">Scegli il lay-out della pagina nuova (dopo la {pages[index]?.order ?? "corrente"}):</p>
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
        <button type="button" className="btn btn--small" disabled={index <= 0} onClick={() => run({ type: "page.move", pageId: currentPageId, toIndex: index - 1 })}>
          ← prima
        </button>
        <button type="button" className="btn btn--small" disabled={index >= pages.length - 1} onClick={() => run({ type: "page.move", pageId: currentPageId, toIndex: index + 1 })}>
          dopo →
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={pages.length <= 1}
          onClick={() => {
            const fallback = pages[index + 1] ?? pages[index - 1];
            if (run({ type: "page.remove", pageId: currentPageId }) && fallback) onSelectPage(fallback.id);
          }}
        >
          elimina
        </button>
      </div>
    </>
  );
}
