import { useEffect, useMemo, useState } from "react";
import { PageSchema, type Page, type Panel, type Balloon, type Scene, type ValidationIssue } from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { renderPreview } from "./renderPreview.js";
import { runBreakdown } from "./runBreakdown.js";
import { initialPages, initialScene, SAMPLE_SCRIPT } from "./samplePage.js";
import { CameraForm } from "./components/CameraForm.js";
import { BalloonEditor } from "./components/BalloonEditor.js";
import { ValidationPanel } from "./components/ValidationPanel.js";
import { SvgPreview } from "./components/SvgPreview.js";
import { ScriptPanel, type ServiceChoice, type BreakdownSummary } from "./components/ScriptPanel.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { exportChapter, type ExportOutcome } from "./exportPages.js";
import { BrowserPlatformService } from "./platform/browserPlatform.js";
import { prefilledConfig } from "./devConfig.js";

/** Un solo servizio per tutta la sessione: la cartella scelta dall'utente dev'essere ricordata. */
const platform = new BrowserPlatformService();

/** Valori di partenza, eventualmente da .env.local in sviluppo. */
const prefilled = prefilledConfig();

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

  const [scene, setScene] = useState<Scene>(initialScene);
  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [service, setService] = useState<ServiceChoice>(
    prefilled.anthropicKeyFromEnv ? "anthropic" : prefilled.deepseekKeyFromEnv ? "deepseek" : "mock",
  );
  const [ollamaModel, setOllamaModel] = useState(prefilled.ollamaModel);
  const [ollamaHost, setOllamaHost] = useState(prefilled.ollamaHost);
  const [anthropicKey, setAnthropicKey] = useState(prefilled.anthropicKey);
  const [anthropicModel, setAnthropicModel] = useState(prefilled.anthropicModel);
  const [deepseekKey, setDeepseekKey] = useState(prefilled.deepseekKey);
  const [deepseekModel, setDeepseekModel] = useState(prefilled.deepseekModel);
  const [running, setRunning] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BreakdownSummary | null>(null);

  // Di default i tre formati del criterio d'uscita di F2.1: pagina digitale,
  // stampa e striscia, dallo stesso documento in un clic.
  const [exportChoices, setExportChoices] = useState<ReadonlySet<string>>(
    () => new Set(["target:digital-page", "target:print-b5", "target:webtoon-strip"]),
  );
  const [exportDraft, setExportDraft] = useState(true);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportOutcome, setExportOutcome] = useState<ExportOutcome | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const { font, bytes: fontBytes, error: fontError } = useFont("/fonts/ComicNeue-Regular.ttf");
  const page = pages[pageIndex]!;

  async function onRunBreakdown() {
    setRunning(true);
    setBreakdownError(null);
    try {
      const result = await runBreakdown({
        script,
        service,
        ollamaModel,
        ollamaHost,
        anthropicKey,
        anthropicModel,
        deepseekKey,
        deepseekModel,
        chapterId: "ep001",
      });
      if (result.pages.length === 0) throw new Error("Lo spoglio non ha prodotto pagine.");
      setPages(result.pages);
      setPageIndex(0);
      setSelectedPanelId(result.pages[0]!.panels[0]!.id);
      // La scena serve al lint per le regole di contenuto (personaggi assenti
      // dalla pagina): senza aggiornarla, resterebbe quella dell'esempio.
      setScene(result.scenes[0] ?? initialScene);
      setSummary(result.summary);
    } catch (error) {
      setBreakdownError(error instanceof Error ? error.message : String(error));
      setSummary(null);
    } finally {
      setRunning(false);
    }
  }

  async function onChooseDestination() {
    setDestination(await platform.chooseDestination());
  }

  async function onExport() {
    if (!font || !fontBytes) return;
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    setExportOutcome(null);
    try {
      const choices = [...exportChoices].map((key) =>
        key.startsWith("target:") ? { kind: "target" as const, id: key.slice("target:".length) } : { kind: key as "document" | "svg" },
      );
      if (choices.length === 0) throw new Error("Scegli almeno un formato.");
      const outcome = await exportChapter({
        pages,
        chapter: { id: page.chapter_id, title: scene.title },
        font,
        fontBytes,
        choices,
        draft: exportDraft,
        onProgress: setExportProgress,
      });
      if (outcome.files.length === 0) throw new Error("Nessun file da esportare.");
      setExportProgress("scrivo i file…");
      const written = await platform.write(outcome.files);
      setExportOutcome(outcome);
      setExportResult(`${written.written} file in ${written.destination}.`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  const parsed = useMemo(() => PageSchema.safeParse(page), [page]);
  const schemaIssues = parsed.success ? [] : parsed.error.issues;

  useEffect(() => {
    if (parsed.success) setLastValidPage(parsed.data);
  }, [parsed]);

  const preview = useMemo(() => {
    if (!font) return null;
    return renderPreview(lastValidPage, font, scene);
  }, [lastValidPage, font, scene]);

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
        <ScriptPanel
          script={script}
          onScriptChange={setScript}
          service={service}
          onServiceChange={setService}
          ollamaModel={ollamaModel}
          onOllamaModelChange={setOllamaModel}
          ollamaHost={ollamaHost}
          onOllamaHostChange={setOllamaHost}
          anthropicKey={anthropicKey}
          onAnthropicKeyChange={setAnthropicKey}
          anthropicModel={anthropicModel}
          onAnthropicModelChange={setAnthropicModel}
          anthropicKeyFromEnv={prefilled.anthropicKeyFromEnv}
          deepseekKey={deepseekKey}
          onDeepseekKeyChange={setDeepseekKey}
          deepseekModel={deepseekModel}
          onDeepseekModelChange={setDeepseekModel}
          deepseekKeyFromEnv={prefilled.deepseekKeyFromEnv}
          onRun={() => void onRunBreakdown()}
          running={running}
          error={breakdownError}
          summary={summary}
        />

        <p className="eyebrow eyebrow-gap">Pagine</p>
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

        {fontError && <p className="preview__note">Font non caricato: {fontError}</p>}
        {!font && !fontError && <p className="muted">Carico il font…</p>}
        <p className="eyebrow eyebrow-gap">Export</p>
        <ExportPanel
          choices={exportChoices}
          onChoicesChange={setExportChoices}
          draft={exportDraft}
          onDraftChange={setExportDraft}
          destination={destination}
          canChooseDestination={platform.canChooseDestination}
          onChooseDestination={() => void onChooseDestination()}
          onExport={() => void onExport()}
          busy={exporting}
          progress={exportProgress}
          outcome={exportOutcome}
          result={exportResult}
          error={exportError}
          pageCount={pages.length}
        />

        <p className="eyebrow eyebrow-gap">Anteprima</p>
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
