import { useCallback, useMemo, useState } from "react";
import { PageSchema, projectDocFrom, type Page, type ValidationIssue } from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { renderPreview } from "./renderPreview.js";
import { runBreakdown } from "./runBreakdown.js";
import { initialPages, initialScene, SAMPLE_SCRIPT } from "./samplePage.js";
import { CameraForm } from "./components/CameraForm.js";
import { BalloonEditor } from "./components/BalloonEditor.js";
import { ValidationPanel } from "./components/ValidationPanel.js";
import { PageEditor } from "./components/PageEditor.js";
import { PanelTools } from "./components/PanelTools.js";
import { PageList } from "./components/PageList.js";
import { ArtCard } from "./components/ArtCard.js";
import { useArtWatcher } from "./editor/useArtWatcher.js";
import { ScriptPanel, type ServiceChoice, type BreakdownSummary } from "./components/ScriptPanel.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { exportChapter, type ExportOutcome } from "./exportPages.js";
import { BrowserPlatformService } from "./platform/browserPlatform.js";
import { prefilledConfig } from "./devConfig.js";
import { project } from "./project.js";
import { useProjectEditor } from "./editor/useProjectEditor.js";
import { ProjectBar } from "./components/ProjectBar.js";

/** Un solo servizio per tutta la sessione: la cartella scelta dall'utente dev'essere ricordata. */
const platform = new BrowserPlatformService();

/** Valori di partenza, eventualmente da .env.local in sviluppo. */
const prefilled = prefilledConfig();

/**
 * Documento di partenza finché non si apre una cartella: il capitolo che lo
 * spoglio produce dalla scena d'esempio, dentro il progetto d'esempio.
 */
const initialDoc = projectDocFrom({
  project,
  scenes: [initialScene],
  chapter: { id: "ep001", number: 1, title: initialScene.title },
  pages: initialPages,
});

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
  const editor = useProjectEditor(initialDoc);
  const { doc, run, endGesture } = editor;
  const art = useArtWatcher(editor.store, doc, run, endGesture);
  const chapter = doc.chapters.chapters[0]!;
  const pages = chapter.pages.map((id) => doc.pages[id]).filter((p): p is Page => p !== undefined);

  // La selezione non è documento: non entra nella cronologia né nel file.
  // Se l'undo toglie la pagina o il pannello selezionato, si ripiega sul primo.
  const [pageId, setPageId] = useState<string>(pages[0]!.id);
  const page = doc.pages[pageId] ?? pages[0]!;
  const [selectedPanelId, setSelectedPanelId] = useState<string>(page.panels[0]!.id);
  const scene = doc.scenes.scenes.find((s) => s.id === page.panels[0]?.scene_id) ?? doc.scenes.scenes[0] ?? initialScene;
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
      // Un nuovo spoglio sostituisce il capitolo, ma resta un passo della
      // cronologia: un Ctrl+Z riporta il lavoro di prima.
      editor.replace(
        projectDocFrom({
          project: doc.project,
          scenes: result.scenes,
          chapter: { id: chapter.id, number: chapter.number, title: result.scenes[0]?.title ?? chapter.title },
          pages: result.pages,
        }),
        "Nuovo spoglio",
      );
      setPageId(result.pages[0]!.id);
      setSelectedPanelId(result.pages[0]!.panels[0]!.id);
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
        chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
        font,
        fontBytes,
        choices,
        draft: exportDraft,
        art: await art.dataUris(doc),
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

  // I comandi tengono valida la griglia; lo schema resta un controllo in più
  // sui campi liberi, e se fallisce l'anteprima non si aggiorna.
  const parsed = useMemo(() => PageSchema.safeParse(page), [page]);
  const schemaIssues = parsed.success ? [] : parsed.error.issues;

  const preview = useMemo(() => {
    if (!font || !parsed.success) return null;
    return renderPreview(parsed.data, font, scene, { art: art.urls });
  }, [parsed, font, scene, art.urls]);

  const issues = preview?.issues ?? [];
  const badges = useMemo(() => worstLevelByPanel(issues), [issues]);
  const panelIds = useMemo(() => new Set(page.panels.map((p) => p.id)), [page]);

  const selectedPanel = page.panels.find((p) => p.id === selectedPanelId) ?? page.panels[0]!;

  const [selectedBalloonId, setSelectedBalloonId] = useState<string | null>(null);

  const goToPage = useCallback(
    (id: string) => {
      const target = doc.pages[id];
      if (!target) return;
      setPageId(id);
      setSelectedPanelId(target.panels[0]!.id);
      setSelectedBalloonId(null);
    },
    [doc.pages],
  );

  const selectPanel = useCallback((id: string) => {
    setSelectedPanelId(id);
    setSelectedBalloonId(null);
  }, []);

  /** Digitare in un campo è un gesto: un passo di undo per campo, chiuso al blur. */
  function patchPanel(field: "action" | "setting", value: string) {
    run({ type: "panel.update", pageId: page.id, panelId: selectedPanel.id, patch: { [field]: value } }, { gesture: `${selectedPanel.id}:${field}` });
  }

  return (
    <div className="shell">
    <ProjectBar editor={editor} title={`${doc.project.title} — ${chapter.title}`} />
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
        <PageList
          chapterId={chapter.id}
          pages={pages}
          currentPageId={page.id}
          sceneId={scene.id}
          onSelectPage={goToPage}
          run={run}
        />
        <p className="page-meta">
          <strong>{page.layout.mode === "page" ? page.layout.template_id : "strip"}</strong> · {page.panels.length} pannelli
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
                  onClick={() => selectPanel(panel.id)}
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
                  onChange={(e) => patchPanel("action", e.target.value)}
                  onBlur={endGesture}
                />
                <span className="field__hint">Per chi disegna è la specifica del pannello, non una nota.</span>
              </label>

              <label className="field">
                <span className="field__label">luogo e ora</span>
                <input
                  type="text"
                  value={selectedPanel.setting}
                  onChange={(e) => patchPanel("setting", e.target.value)}
                  onBlur={endGesture}
                />
              </label>
            </div>
          </div>

          <PanelTools page={page} panel={selectedPanel} run={run} onSelectPanel={selectPanel} />

          <ArtCard pageId={page.id} panel={selectedPanel} store={editor.store} url={art.urls.get(selectedPanel.id)} run={run} scan={art.scan} />

          <div className="card">
            <p className="card__title">camera</p>
            <CameraForm
              camera={selectedPanel.camera}
              onChange={(camera) => run({ type: "panel.camera", pageId: page.id, panelId: selectedPanel.id, camera })}
            />
          </div>

          {selectedPanel.balloons.map((balloon) => (
            <BalloonEditor
              key={balloon.id}
              balloon={balloon}
              onText={(text) => run({ type: "balloon.text", pageId: page.id, balloonId: balloon.id, text }, { gesture: `${balloon.id}:text` })}
              onAnchor={(anchor) => run({ type: "balloon.move", pageId: page.id, balloonId: balloon.id, anchor }, { gesture: `${balloon.id}:anchor` })}
              onTail={(tail) => run({ type: "balloon.tail", pageId: page.id, balloonId: balloon.id, tail }, { gesture: `${balloon.id}:tail` })}
              onRemove={() => run({ type: "balloon.remove", pageId: page.id, balloonId: balloon.id })}
              onCommit={endGesture}
            />
          ))}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => run({ type: "balloon.add", pageId: page.id, panelId: selectedPanel.id, text: [{ t: "Nuovo balloon" }] })}
          >
            + balloon
          </button>
        </div>
      </section>

      <section className="col">
        <p className="eyebrow">Pagina {page.order}</p>
        {preview && (
          <PageEditor
            page={page}
            svg={preview.svg}
            boxes={preview.boxes}
            fits={preview.fits}
            width={preview.width}
            height={preview.height}
            selectedPanelId={selectedPanel.id}
            selectedBalloonId={selectedBalloonId}
            onSelectPanel={selectPanel}
            onSelectBalloon={(balloonId, panelId) => {
              setSelectedPanelId(panelId);
              setSelectedBalloonId(balloonId);
            }}
            run={run}
            endGesture={endGesture}
            staleNote={schemaIssues.length > 0}
          />
        )}
        <p className="field__hint">Clic su un pannello per selezionarlo · trascina balloon, punta della coda e gutter · Ctrl+Z annulla.</p>

        <p className="eyebrow eyebrow-gap">Validazione</p>
        <ValidationPanel
          schemaIssues={schemaIssues}
          docIssues={[...editor.loadIssues, ...issues]}
          onSelectPanel={selectPanel}
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

      </section>
    </div>
    </div>
  );
}
