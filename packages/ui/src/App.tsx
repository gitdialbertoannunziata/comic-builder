import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  balloonBox,
  chapterContext,
  characterRefs,
  compilePageBrief,
  compilePanel,
  lintCharacters,
  nextChapterId,
  PageSchema,
  pageForTarget,
  projectDocFrom,
  type Chapter,
  type Page,
  type ValidationIssue,
} from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { pageTargets, renderPreview } from "./renderPreview.js";
import { runBreakdown } from "./runBreakdown.js";
import { initialPages, initialScene, SAMPLE_SCRIPT } from "./samplePage.js";
import { CameraForm } from "./components/CameraForm.js";
import { BalloonEditor } from "./components/BalloonEditor.js";
import { ValidationPanel } from "./components/ValidationPanel.js";
import { PageEditor } from "./components/PageEditor.js";
import { PanelTools } from "./components/PanelTools.js";
import { PageList } from "./components/PageList.js";
import { ArtCard } from "./components/ArtCard.js";
import { useArtWatcher, type ArtWatcher } from "./editor/useArtWatcher.js";
import { ChapterBar } from "./components/ChapterBar.js";
import { loadPreference, savePreference } from "./platform/session.js";

/**
 * Uno stato che sopravvive a un F5 (localStorage). Solo preferenze
 * dell'interfaccia: mai chiavi API, che digitate nella UI non si salvano.
 */
function usePreference<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => loadPreference(key, initial));
  useEffect(() => savePreference(key, value), [key, value]);
  return [value, setValue];
}
import { importArt, panelForFileName } from "./editor/importArt.js";
import { StripView } from "./components/StripView.js";
import { RevisionsPanel } from "./components/RevisionsPanel.js";
import { PromptCard } from "./components/PromptCard.js";
import { CharactersPanel } from "./components/CharactersPanel.js";
import { PanelCharacters } from "./components/PanelCharacters.js";
import { measureWith } from "@comic-builder/lettering";
import { primaryTarget, styles as projectStyles } from "./project.js";
import { ScriptPanel, type ServiceChoice, type BreakdownSummary } from "./components/ScriptPanel.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { exportChapter, type ExportOutcome } from "./exportPages.js";
import { BrowserPlatformService } from "./platform/browserPlatform.js";
import { prefilledConfig } from "./devConfig.js";
import { project } from "./project.js";
import { useProjectEditor, type ProjectEditor } from "./editor/useProjectEditor.js";
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
  script: SAMPLE_SCRIPT,
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

/**
 * L'opera: capitoli, copione e spoglio. Ciò che riguarda un capitolo aperto
 * — pagine, pannelli, anteprima, revisioni, export — sta nel Workspace, che
 * esiste solo se il capitolo ha pagine e riparte da capo cambiando capitolo.
 */
export function App() {
  const editor = useProjectEditor(initialDoc);
  const { doc, run, endGesture } = editor;
  const art = useArtWatcher(editor.assets, doc, run, endGesture);
  const chapters = doc.chapters.chapters;
  // Il capitolo aperto, per progetto: dopo un F5 si riparte da lì.
  const [chapterId, setChapterId] = usePreference(`chapter:${doc.project.id}`, chapters[0]!.id);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]!;
  const pages = chapter.pages.map((id) => doc.pages[id]).filter((p): p is Page => p !== undefined);

  // Il copione che si sta scrivendo, per capitolo: finché non si spoglia è
  // una bozza della scheda; spogliato, diventa il copione del capitolo.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const script = drafts[chapter.id] ?? doc.scripts[chapter.id] ?? "";
  const setScript = (text: string) => setDrafts((d) => ({ ...d, [chapter.id]: text }));
  const [service, setService] = usePreference<ServiceChoice>(
    "service",
    prefilled.anthropicKeyFromEnv ? "anthropic" : prefilled.deepseekKeyFromEnv ? "deepseek" : "mock",
  );
  const [ollamaModel, setOllamaModel] = usePreference("ollamaModel", prefilled.ollamaModel);
  const [ollamaHost, setOllamaHost] = usePreference("ollamaHost", prefilled.ollamaHost);
  const [anthropicKey, setAnthropicKey] = useState(prefilled.anthropicKey);
  const [anthropicModel, setAnthropicModel] = usePreference("anthropicModel", prefilled.anthropicModel);
  const [deepseekKey, setDeepseekKey] = useState(prefilled.deepseekKey);
  const [deepseekModel, setDeepseekModel] = usePreference("deepseekModel", prefilled.deepseekModel);
  const [running, setRunning] = useState(false);
  const [breakdownProgress, setBreakdownProgress] = useState<{ done: number; total: number } | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BreakdownSummary | null>(null);

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
        chapterId: chapter.id,
        // Gli altri capitoli: personaggi esistenti e riassunto del precedente.
        context: chapterContext(doc, chapter.id),
        onProgress: setBreakdownProgress,
      });
      if (result.pages.length === 0) throw new Error("Lo spoglio non ha prodotto pagine.");
      // Lo spoglio riempie il capitolo aperto e basta: gli altri restano come
      // sono. È un passo della cronologia: Ctrl+Z riporta il capitolo di prima.
      const gesture = `breakdown-${chapter.id}-${Date.now()}`;
      run({ type: "chapter.set-content", chapterId: chapter.id, pages: result.pages, scenes: result.scenes, script }, { gesture });
      if (!chapter.title.trim() || /^Capitolo \d+$/.test(chapter.title)) {
        run({ type: "chapter.update", chapterId: chapter.id, title: result.scenes[0]?.title ?? chapter.title }, { gesture });
      }
      endGesture();
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== chapter.id)));
      setSummary(result.summary);
    } catch (error) {
      setBreakdownError(error instanceof Error ? error.message : String(error));
      setSummary(null);
    } finally {
      setRunning(false);
      setBreakdownProgress(null);
    }
  }

  const sidebarTop = (
    <>
      <p className="eyebrow">Capitoli</p>
      <ChapterBar chapters={chapters} currentId={chapter.id} onSelect={setChapterId} run={run} endGesture={endGesture} nextId={nextChapterId(doc).id} />
      <div className="eyebrow-gap" />
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
          progress={breakdownProgress}
          error={breakdownError}
          summary={summary}
        />
    </>
  );

  return (
    <div className="shell">
      <ProjectBar editor={editor} title={`${doc.project.title} — ${chapter.number}. ${chapter.title}`} />
      {pages.length > 0 ? (
        <Workspace
          key={chapter.id}
          editor={editor}
          art={art}
          chapter={chapter}
          pages={pages}
          font={font}
          fontBytes={fontBytes}
          fontError={fontError}
          sidebarTop={sidebarTop}
        />
      ) : (
        <div className="app">
          <aside className="col">{sidebarTop}</aside>
          <section className="col col--empty">
            <div className="empty-chapter">
              <p className="eyebrow">Capitolo {chapter.number} — vuoto</p>
              <p>Incolla il copione di questo capitolo e premi «Spoglia il capitolo»: le pagine nascono da lì.</p>
              <p className="field__hint">
                Personaggi, schede e stile sono dell'opera e valgono anche qui. Lo spoglio riceve i personaggi già esistenti e un
                riassunto del capitolo precedente, così i nomi restano quelli.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

interface WorkspaceProps {
  editor: ProjectEditor;
  art: ArtWatcher;
  chapter: Chapter;
  pages: Page[];
  font: ReturnType<typeof useFont>["font"];
  fontBytes: ReturnType<typeof useFont>["bytes"];
  fontError: ReturnType<typeof useFont>["error"];
  /** La parte alta della colonna di sinistra: capitoli e copione, che appartengono all'opera. */
  sidebarTop: ReactNode;
}

/** Il capitolo aperto: pagine, pannelli, anteprima, revisioni, export. */
function Workspace({ editor, art, chapter, pages, font, fontBytes, fontError, sidebarTop }: WorkspaceProps) {
  const { doc, run, endGesture } = editor;
  // La selezione non è documento: non entra nella cronologia né nel file.
  // Se l'undo toglie la pagina o il pannello selezionato, si ripiega sul primo.
  const [pageId, setPageId] = useState<string>(pages[0]!.id);
  const page = doc.pages[pageId] ?? pages[0]!;
  const [selectedPanelId, setSelectedPanelId] = useState<string>(page.panels[0]!.id);
  const scene = doc.scenes.scenes.find((s) => s.id === page.panels[0]?.scene_id) ?? doc.scenes.scenes[0] ?? initialScene;

  // Di default i tre formati del criterio d'uscita di F2.1: pagina digitale,
  // stampa e striscia, dallo stesso documento in un clic.
  const [exportChoiceList, setExportChoiceList] = usePreference<string[]>("exportChoices", ["target:digital-page", "target:print-b5", "target:webtoon-strip"]);
  const exportChoices = useMemo(() => new Set(exportChoiceList), [exportChoiceList]);
  const setExportChoices = (choices: ReadonlySet<string>) => setExportChoiceList([...choices]);
  const [exportDraft, setExportDraft] = usePreference("exportDraft", true);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportOutcome, setExportOutcome] = useState<ExportOutcome | null>(null);
  const [destination, setDestination] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
        key.startsWith("target:") ? { kind: "target" as const, id: key.slice("target:".length) } : { kind: key as "document" | "svg" | "prompts" },
      );
      if (choices.length === 0) throw new Error("Scegli almeno un formato.");
      const outcome = await exportChapter({
        pages,
        chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
        projectStyle: doc.project.style,
        characters: doc.characters,
        seriesSeed: doc.project.series_seed,
        scenes: doc.scenes.scenes,
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
  // Formato in cui si guarda (e si ritoccano i balloon di) la pagina.
  const [pageTargetId, setPageTargetId] = useState(primaryTarget.id);
  const schemaIssues = parsed.success ? [] : parsed.error.issues;

  const preview = useMemo(() => {
    if (!font || !parsed.success) return null;
    return renderPreview(parsed.data, font, scene, { art: art.urls, targetId: pageTargetId });
  }, [parsed, font, scene, art.urls, pageTargetId]);

  const issues = preview?.issues ?? [];
  const badges = useMemo(() => worstLevelByPanel(issues), [issues]);
  const panelIds = useMemo(() => new Set(page.panels.map((p) => p.id)), [page]);

  const selectedPanel = page.panels.find((p) => p.id === selectedPanelId) ?? page.panels[0]!;

  const [selectedBalloonId, setSelectedBalloonId] = useState<string | null>(null);
  const [view, setView] = useState<"page" | "scroll">("page");
  const [dropNote, setDropNote] = useState<string | null>(null);
  const stripTargetId = doc.project.targets.find((t) => t.kind === "strip")?.id ?? null;

  // Il contesto della striscia cambia solo quando cambia il documento: la
  // vista scroll ricalcola tagli e misure lì, non a ogni render.
  const stripContext = useMemo(
    () =>
      font
        ? {
            project: doc.project,
            pages,
            chapter: { id: chapter.id },
            styles: projectStyles,
            measure: measureWith(font),
            draft: true,
            art: art.urls,
          }
        : null,
    // `pages` deriva da `doc`: basta `doc` a dire quando è cambiato.
    [doc, font, art.urls],
  );

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

  /** Seleziona un pannello ovunque sia nel capitolo, spostandosi sulla sua pagina. */
  const revealPanel = useCallback(
    (panelId: string) => {
      const owner = Object.values(doc.pages).find((p) => p.panels.some((x) => x.id === panelId));
      if (!owner) return;
      setPageId(owner.id);
      setSelectedPanelId(panelId);
      setSelectedBalloonId(null);
    },
    [doc.pages],
  );

  const selectPanel = useCallback((id: string) => {
    setSelectedPanelId(id);
    setSelectedBalloonId(null);
  }, []);

  // Il formato di cui si modificano posizione e corpo dei balloon: quello
  // mostrato in pagina, o la striscia nella vista scroll. Null = il principale.
  const editTarget = view === "scroll" ? stripTargetId : pageTargetId === primaryTarget.id ? null : pageTargetId;
  const shownPage = editTarget ? pageForTarget(page, editTarget) : page;
  const forTarget = editTarget ? { target: editTarget } : {};

  // Istruzioni per un modello esterno (§9.1), compilate dalla pagina com'è nel
  // formato mostrato: proporzioni e zone dei balloon sono quelle vere.
  const briefs = useMemo(() => {
    if (!preview || preview.shownPage.layout.mode !== "page") return null;
    const shown = preview.shownPage;
    const byId = new Map(shown.panels.map((p) => [p.id, p]));
    const panels = shown.layout.mode === "page" ? shown.layout.reading_order.map((id) => byId.get(id)).filter((p): p is (typeof shown.panels)[number] => p !== undefined) : [];
    const list = panels.flatMap((panel) => {
      const panelBox = preview.boxes.get(panel.id);
      if (!panelBox) return [];
      const balloonBoxes = panel.balloons.flatMap((b) => {
        const fit = preview.fits.get(b.id);
        return fit ? [{ id: b.id, box: balloonBox(b, panelBox, fit) }] : [];
      });
      return [compilePanel({ project: doc.project, page: shown, panel, panelBox, balloonBoxes, targetId: preview.targetId, scene, characters: doc.characters })];
    });
    const page = compilePageBrief({
      page: shown,
      pageBox: { x: 0, y: 0, width: preview.width, height: preview.height },
      panels: list,
      boxes: preview.boxes,
      readingDirection: doc.project.reading_direction,
    });
    return { list, page };
  }, [preview, doc.project, doc.characters, scene]);
  const refs = useMemo(() => [...characterRefs(doc)].sort(), [doc]);

  // Avvisi sui personaggi (Appendice A) che riguardano la pagina aperta.
  const characterIssues = useMemo(() => {
    const onPage = new Set(page.panels.flatMap((p) => p.characters.map((c) => c.ref)));
    return lintCharacters(doc).filter((i) => i.path.startsWith(`pages[${page.id}]`) || (i.code === "content.no-character-sheet" && [...onPage].some((r) => i.path === `characters[${r}]`)));
  }, [doc, page]);
  const selectedBrief = briefs?.list.find((b) => b.panelId === selectedPanel.id) ?? null;

  /**
   * Immagini trascinate sulla pagina. Una sola va al pannello su cui cade;
   * più d'una, ognuna al pannello col suo nome (`ep001-p001-03.png`) — il
   * modo di caricare una pagina intera in un gesto.
   */
  async function dropArt(files: File[], panelId: string | null) {
    const problems: string[] = [];
    let linked = 0;
    const single = files.length === 1 && panelId ? page.panels.find((p) => p.id === panelId) : undefined;
    for (const file of files) {
      const target = single ? { pageId: page.id, panel: single } : panelForFileName(doc, file.name);
      if (!target) {
        problems.push(`«${file.name}» non ha il nome di un pannello`);
        continue;
      }
      const problem = await importArt(editor.assets, run, target.pageId, target.panel, file);
      if (problem) problems.push(problem);
      else linked++;
    }
    await art.scan();
    if (single) selectPanel(single.id);
    if (problems.length > 0) {
      setDropNote(`${linked} immagini collegate. ${problems.join("; ")}${files.length > 1 ? ". Con più file insieme, ognuno va al pannello col suo nome." : ""}`);
    } else {
      setDropNote(linked > 1 ? `${linked} immagini collegate ai loro pannelli.` : null);
    }
  }

  /** Digitare in un campo è un gesto: un passo di undo per campo, chiuso al blur. */
  function patchPanel(field: "action" | "setting", value: string) {
    run({ type: "panel.update", pageId: page.id, panelId: selectedPanel.id, patch: { [field]: value } }, { gesture: `${selectedPanel.id}:${field}` });
  }

  return (
    <div className="app">
      <aside className="col">
        {sidebarTop}

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

          <ArtCard
            pageId={page.id}
            panel={selectedPanel}
            store={editor.assets}
            inMemory={editor.store === null}
            url={art.urls.get(selectedPanel.id)}
            run={run}
            scan={art.scan}
          />

          <PanelTools page={page} panel={selectedPanel} run={run} onSelectPanel={selectPanel} />

          <PanelCharacters pageId={page.id} panel={selectedPanel} refs={refs} sheets={doc.characters} run={run} endGesture={endGesture} />

          {selectedBrief && briefs && (
            <PromptCard
              brief={selectedBrief}
              pageBrief={briefs.page}
              panel={selectedPanel}
              pageId={page.id}
              project={doc.project}
              run={run}
              endGesture={endGesture}
            />
          )}


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
              shown={shownPage.panels.find((p) => p.id === selectedPanel.id)?.balloons.find((b) => b.id === balloon.id) ?? balloon}
              target={editTarget}
              onText={(text) => run({ type: "balloon.text", pageId: page.id, balloonId: balloon.id, text }, { gesture: `${balloon.id}:text` })}
              onAnchor={(anchor) => run({ type: "balloon.move", pageId: page.id, balloonId: balloon.id, anchor, ...forTarget }, { gesture: `${balloon.id}:anchor` })}
              onTail={(tail) => run({ type: "balloon.tail", pageId: page.id, balloonId: balloon.id, tail, ...forTarget }, { gesture: `${balloon.id}:tail` })}
              onScale={(fontScale) => run({ type: "balloon.scale", pageId: page.id, balloonId: balloon.id, fontScale, ...forTarget }, { gesture: `${balloon.id}:scale` })}
              onReset={() => editTarget && run({ type: "balloon.reset", pageId: page.id, balloonId: balloon.id, target: editTarget })}
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
        <div className="view-head">
          <p className="eyebrow">{view === "page" ? `Pagina ${page.order}` : "Striscia dell'episodio"}</p>
          <div className="segmented" role="tablist" aria-label="Vista">
            {pageTargets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="seg"
                aria-pressed={view === "page" && pageTargetId === t.id}
                onClick={() => {
                  setView("page");
                  setPageTargetId(t.id);
                }}
                title={t.primary ? "Formato principale: qui si ritocca tutto" : "Qui si spostano solo i balloon, per questo formato"}
              >
                {t.id}
              </button>
            ))}
            <button type="button" className="seg" aria-pressed={view === "scroll"} onClick={() => setView("scroll")} disabled={!stripTargetId}>
              scroll
            </button>
          </div>
        </div>
        {view === "scroll" && stripContext && stripTargetId && (
          <StripView
            context={stripContext}
            targetId={stripTargetId}
            selectedPanelId={selectedPanel.id}
            onSelect={(targetPageId, panelId) => {
              setPageId(targetPageId);
              setSelectedPanelId(panelId);
              setSelectedBalloonId(null);
            }}
            selectedBalloonId={selectedBalloonId}
            onSelectBalloon={(targetPageId, panelId, balloonId) => {
              setPageId(targetPageId);
              setSelectedPanelId(panelId);
              setSelectedBalloonId(balloonId);
            }}
            run={run}
          />
        )}
        {view === "page" && preview && (
          <PageEditor
            page={page}
            shownPage={preview.shownPage}
            targetId={preview.targetId}
            primary={preview.targetId === primaryTarget.id}
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
            onDropFiles={(files, panelId) => void dropArt(files, panelId)}
          />
        )}
        {view === "page" && dropNote && <p className="issue issue--info">{dropNote}</p>}
        {view === "page" && (
          <p className="field__hint">
            {pageTargetId === primaryTarget.id
              ? "Clic su un pannello per selezionarlo · trascina balloon, punta della coda e gutter · trascina un'immagine su un pannello per dargliela · Ctrl+Z annulla."
              : `In ${pageTargetId} si spostano solo i balloon, e solo per questo formato. Griglia e pannelli si ritoccano sul formato principale.`}
          </p>
        )}

        <p className="eyebrow eyebrow-gap">Validazione</p>
        <ValidationPanel
          schemaIssues={schemaIssues}
          docIssues={[...editor.loadIssues, ...issues, ...characterIssues]}
          onSelectPanel={selectPanel}
          knownPanelIds={panelIds}
        />

        {fontError && <p className="preview__note">Font non caricato: {fontError}</p>}
        {!font && !fontError && <p className="muted">Carico il font…</p>}
        <p className="eyebrow eyebrow-gap">Personaggi</p>
        <CharactersPanel doc={doc} store={editor.assets} run={run} endGesture={endGesture} />

        <p className="eyebrow eyebrow-gap">Revisioni</p>
        <RevisionsPanel
          doc={doc}
          chapterId={chapter.id}
          run={run}
          endGesture={endGesture}
          onSelectPanel={revealPanel}
          write={async (files) => (await platform.write(files)).destination}
        />

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
  );
}
