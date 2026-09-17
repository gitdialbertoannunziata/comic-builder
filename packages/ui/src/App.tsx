import { useEffect, useMemo, useState } from "react";
import { PageSchema, type Page, type Panel, type Balloon, type ValidationIssue } from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { renderPreview } from "./renderPreview.js";
import { initialPages, initialScene } from "./samplePage.js";
import { CameraForm } from "./components/CameraForm.js";
import { BalloonEditor } from "./components/BalloonEditor.js";
import { ValidationPanel } from "./components/ValidationPanel.js";
import { SvgPreview } from "./components/SvgPreview.js";

function updatePanel(page: Page, panelId: string, updater: (panel: Panel) => Panel): Page {
  return { ...page, panels: page.panels.map((p) => (p.id === panelId ? updater(p) : p)) };
}

function updateBalloon(panel: Panel, balloonId: string, updater: (balloon: Balloon) => Balloon): Panel {
  return { ...panel, balloons: panel.balloons.map((b) => (b.id === balloonId ? updater(b) : b)) };
}

/** Livello più grave fra gli issue che riguardano un pannello, per il pallino nell'elenco. */
function worstLevelByPanel(issues: ValidationIssue[]): Map<string, ValidationIssue["level"]> {
  const rank = { info: 0, warning: 1, error: 2 } as const;
  const worst = new Map<string, ValidationIssue["level"]>();

  for (const issue of issues) {
    const match = /panels\[([^\]]+)\]/.exec(issue.path);
    const panelId = match?.[1];
    if (!panelId) continue;
    const previous = worst.get(panelId);
    if (!previous || rank[issue.level] > rank[previous]) worst.set(panelId, issue.level);
  }
  return worst;
}

export function App() {
  const [pages, setPages] = useState<Page[]>(initialPages);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedPanelId, setSelectedPanelId] = useState<string>(initialPages[0]!.panels[0]!.id);
  const [lastValidPage, setLastValidPage] = useState<Page>(initialPages[0]!);

  const { font, error: fontError } = useFont("/fonts/ComicNeue-Regular.ttf");
  const page = pages[pageIndex]!;

  const parsed = useMemo(() => PageSchema.safeParse(page), [page]);
  const schemaIssues = parsed.success ? [] : parsed.error.issues;

  useEffect(() => {
    if (parsed.success) setLastValidPage(parsed.data);
  }, [parsed]);

  const preview = useMemo(() => {
    if (!font) return null;
    return renderPreview(lastValidPage, font, initialScene);
  }, [lastValidPage, font]);

  const issues = preview?.issues ?? [];
  const badges = useMemo(() => worstLevelByPanel(issues), [issues]);
  const panelIds = useMemo(() => new Set(page.panels.map((p) => p.id)), [page]);

  const selectedPanel = page.panels.find((p) => p.id === selectedPanelId) ?? page.panels[0]!;

  function patchSelectedPanel(updater: (panel: Panel) => Panel) {
    setPages((prev) => prev.map((p, i) => (i === pageIndex ? updatePanel(p, selectedPanel.id, updater) : p)));
  }

  function goToPage(index: number) {
    setPageIndex(index);
    setSelectedPanelId(pages[index]!.panels[0]!.id);
  }

  return (
    <div className="app">
      <aside className="col">
        <p className="eyebrow">Pagine</p>
        <div className="pages">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="page-chip"
              aria-pressed={i === pageIndex}
              onClick={() => goToPage(i)}
            >
              {p.id}
            </button>
          ))}
        </div>
        <p className="page-meta">
          <strong>{page.layout.mode === "page" ? page.layout.template_id : "strip"}</strong>, scelto dal catalogo
          sui beat della scena
        </p>

        <p className="eyebrow">Pannelli</p>
        <ul className="panel-list">
          {page.panels.map((panel) => {
            const level = badges.get(panel.id);
            return (
              <li key={panel.id}>
                <button
                  type="button"
                  className="panel-row"
                  aria-current={panel.id === selectedPanelId}
                  onClick={() => setSelectedPanelId(panel.id)}
                >
                  <span>
                    <span className="panel-row__shot">
                      {panel.camera.shot} · {panel.camera.angle}
                    </span>
                    <span className="panel-row__action">{panel.action || "—"}</span>
                  </span>
                  <span className="panel-row__badges">
                    {level && <span className={`dot dot--${level}`} title={`${level} su questo pannello`} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="col col--work">
        <p className="eyebrow">
          <span className="panel-id">{selectedPanel.id}</span>
        </p>

        <div className="stack">
          <div className="card">
            <div className="stack">
              <label className="field">
                <span className="field__label">azione</span>
                <textarea
                  value={selectedPanel.action}
                  rows={2}
                  onChange={(e) => {
                    const value = e.target.value;
                    patchSelectedPanel((panel) => ({ ...panel, action: value }));
                  }}
                />
                <span className="field__hint">Per chi disegna è la specifica del pannello, non una nota.</span>
              </label>

              <label className="field">
                <span className="field__label">luogo e ora</span>
                <input
                  type="text"
                  value={selectedPanel.setting}
                  onChange={(e) => {
                    const value = e.target.value;
                    patchSelectedPanel((panel) => ({ ...panel, setting: value }));
                  }}
                />
              </label>
            </div>
          </div>

          <div className="card">
            <p className="card__title">camera</p>
            <CameraForm
              camera={selectedPanel.camera}
              onChange={(camera) => patchSelectedPanel((panel) => ({ ...panel, camera }))}
            />
          </div>

          {selectedPanel.balloons.map((balloon) => (
            <BalloonEditor
              key={balloon.id}
              balloon={balloon}
              onChange={(updated) => patchSelectedPanel((panel) => updateBalloon(panel, balloon.id, () => updated))}
            />
          ))}
        </div>
      </section>

      <section className="col">
        <p className="eyebrow">Validazione</p>
        <ValidationPanel
          schemaIssues={schemaIssues}
          docIssues={issues}
          onSelectPanel={setSelectedPanelId}
          knownPanelIds={panelIds}
        />

        <p className="eyebrow eyebrow-gap">Anteprima</p>
        {fontError && <p className="preview__note">Font non caricato: {fontError}</p>}
        {!font && !fontError && <p className="muted">Carico il font…</p>}
        {preview && (
          <SvgPreview
            svg={preview.svg}
            boxes={preview.boxes}
            width={preview.width}
            height={preview.height}
            selectedPanelId={selectedPanelId}
            onSelectPanel={setSelectedPanelId}
            staleNote={schemaIssues.length > 0}
          />
        )}
      </section>
    </div>
  );
}
