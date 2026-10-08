import { useCallback, useEffect, useMemo, useState } from "react";
import {
  balloonBox,
  characterRefs,
  compilePageBrief,
  compilePanel,
  compileRenderSpec,
  lintCharacters,
  lintRevisions,
  lintPage,
  PageSchema,
  pageForTarget,
  validateDocument,
  type Chapter,
  type Page,
  type ValidationIssue,
} from "@comic-builder/core";
import { measureWith } from "@comic-builder/lettering";
import type { useFont } from "../useFont.js";
import { pageTargets, renderPreview } from "../renderPreview.js";
import { initialScene } from "../samplePage.js";
import { SHOT_LABELS } from "../cameraOptions.js";
import { targetLabel } from "../labels.js";
import { usePreference } from "../usePreference.js";
import { primaryTarget, styles as projectStyles } from "../project.js";
import { exportChapter, type ExportOutcome } from "../exportPages.js";
import type { BrowserPlatformService } from "../platform/browserPlatform.js";
import type { ProjectEditor } from "../editor/useProjectEditor.js";
import type { ArtWatcher } from "../editor/useArtWatcher.js";
import { importArt, panelForFileName } from "../editor/importArt.js";
import { CameraForm } from "./CameraForm.js";
import { BalloonEditor } from "./BalloonEditor.js";
import { ValidationPanel } from "./ValidationPanel.js";
import { PageEditor } from "./PageEditor.js";
import { PanelTools } from "./PanelTools.js";
import { PageList } from "./PageList.js";
import { ArtCard } from "./ArtCard.js";
import { StripView } from "./StripView.js";
import { RevisionsPanel } from "./RevisionsPanel.js";
import { NoteButton } from "./NoteButton.js";
import { PromptCard } from "./PromptCard.js";
import { GenerateCard, specModel, type ImageConfig } from "./GenerateCard.js";
import { PanelCharacters } from "./PanelCharacters.js";
import { ExportPanel } from "./ExportPanel.js";
import { Tabs } from "./Tabs.js";
import { Section } from "./Section.js";

/** Le aree di lavoro: una alla volta, scelte dalla barra. */
export type Area = "copione" | "pagine" | "personaggi" | "revisioni" | "export";

type InspectorTab = "vignetta" | "balloon" | "arte";

const LEVELS = ["error", "warning", "info"] as const;
const LEVEL_LABEL: Record<ValidationIssue["level"], [string, string]> = {
  error: ["errore", "errori"],
  warning: ["avviso", "avvisi"],
  info: ["nota", "note"],
};

function countByLevel(issues: readonly ValidationIssue[]): Record<ValidationIssue["level"], number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.level]++;
  return counts;
}

/** «2 errori · 1 avviso», coi pallini del lint; niente se non c'è niente. */
function LevelCounts({ counts }: { counts: Record<ValidationIssue["level"], number> }) {
  const shown = LEVELS.filter((level) => counts[level] > 0);
  if (shown.length === 0) return <span className="level-counts level-counts--ok">nessun problema</span>;
  return (
    <span className="level-counts">
      {shown.map((level) => (
        <span key={level} className="level-counts__item">
          <span className={`dot dot--${level}`} />
          {counts[level]} {LEVEL_LABEL[level][counts[level] === 1 ? 0 : 1]}
        </span>
      ))}
    </span>
  );
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

interface WorkspaceProps {
  editor: ProjectEditor;
  art: ArtWatcher;
  platform: BrowserPlatformService;
  image: ImageConfig;
  chapter: Chapter;
  pages: Page[];
  font: ReturnType<typeof useFont>["font"];
  fontBytes: ReturnType<typeof useFont>["bytes"];
  fontError: ReturnType<typeof useFont>["error"];
  area: Area;
  onArea: (area: Area) => void;
}

/**
 * Il capitolo aperto: l'area Pagine (navigatore, tela, ispettore), le
 * Revisioni e l'Export. Le tre aree restano montate e si nascondono: ciò
 * che si è incollato o scelto in una non si perde passando a un'altra.
 */
export function Workspace({ editor, art, platform, image, chapter, pages, font, fontBytes, fontError, area, onArea }: WorkspaceProps) {
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
  const [fit, setFit] = usePreference<"page" | "width">("canvasFit", "page");
  const [inspectorTab, setInspectorTab] = usePreference<InspectorTab>("inspectorTab", "vignetta");
  const [dropNote, setDropNote] = useState<string | null>(null);
  // Inquadratura dell'arte sulla pagina: vale per il pannello selezionato, finché non la si chiude.
  const [framing, setFraming] = useState(false);
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
      onArea("pagine");
    },
    [doc.pages, onArea],
  );

  const selectPanel = useCallback((id: string) => {
    setSelectedPanelId(id);
    setFraming(false);
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

  // Gli spec di generazione (§9.1) per la pagina, solo sul formato principale:
  // è lì che `panel.render` conta per l'anteprima e per l'export.
  const model = specModel(image);
  const generation = useMemo(() => {
    if (!briefs || !preview || preview.targetId !== primaryTarget.id) return null;
    return briefs.list.flatMap((brief) => {
      const panel = page.panels.find((p) => p.id === brief.panelId);
      return panel ? [{ pageId: page.id, panel, spec: compileRenderSpec({ brief, panel, characters: doc.characters, model, megapixels: image.megapixels }) }] : [];
    });
  }, [briefs, preview, page, doc.characters, model, image.megapixels]);

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

  const selectBalloon = useCallback(
    (balloonId: string | null) => {
      setSelectedBalloonId(balloonId);
      if (balloonId) setInspectorTab("balloon");
    },
    [setInspectorTab],
  );

  // Il balloon scelto sulla pagina: il suo editor entra in vista nell'ispettore.
  useEffect(() => {
    if (selectedBalloonId) document.getElementById(`balloon-${selectedBalloonId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedBalloonId, inspectorTab]);

  // Il changelog che non corrisponde più al documento è un avviso del capitolo, visibile da ogni sua pagina.
  const revisionIssues = useMemo(() => lintRevisions(doc).filter((i) => i.path.startsWith(`revisions[${chapter.id}]`)), [doc, chapter.id]);
  const pageIssues = useMemo(() => [...editor.loadIssues, ...issues, ...characterIssues, ...revisionIssues], [editor.loadIssues, issues, characterIssues, revisionIssues]);
  const pageCounts = useMemo(() => {
    const counts = countByLevel(pageIssues);
    return { ...counts, error: counts.error + schemaIssues.length };
  }, [pageIssues, schemaIssues]);

  // Il controllo di tutto il capitolo serve solo prima di esportare: lo si
  // calcola lì, non a ogni tasto mentre si lavora su una pagina.
  const chapterCheck = useMemo(() => {
    if (area !== "export") return null;
    return pages.map((p) => {
      const pageScene = doc.scenes.scenes.find((s) => s.id === p.panels[0]?.scene_id);
      const found = [...validateDocument(p), ...lintPage(p, { target: primaryTarget.id, ...(pageScene ? { scene: pageScene } : {}) })];
      return { page: p, counts: countByLevel(found) };
    });
  }, [area, pages, doc.scenes.scenes]);

  const panelNumber = (panelId: string) => {
    const order = page.layout.mode === "page" ? page.layout.reading_order : page.panels.map((p) => p.id);
    return order.indexOf(panelId) + 1;
  };
  const openEntries = useMemo(() => (doc.revisions[chapter.id]?.entries ?? []).filter((e) => e.status === "open"), [doc.revisions, chapter.id]);
  const openRevisions = openEntries.length;
  // Quante voci aperte su ogni vignetta e su ogni pagina (le sue e quelle delle sue vignette).
  const openBy = useMemo(() => {
    const panelPage = new Map(pages.flatMap((p) => p.panels.map((x) => [x.id, p.id] as const)));
    const counts = new Map<string, number>();
    const bump = (id: string | null | undefined) => id && counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const e of openEntries) {
      bump(e.panel);
      bump(e.panel ? panelPage.get(e.panel) : e.page);
    }
    return counts;
  }, [openEntries, pages]);
  const [revisionFilter, setRevisionFilter] = useState<string | null>(null);
  const showRevisions = (id: string) => {
    setRevisionFilter(id);
    onArea("revisioni");
  };
  const annotate = (target: { panel?: string; balloon?: string; page?: string }, text: string) =>
    run({
      type: "revision.add",
      chapterId: chapter.id,
      entries: [{ origin: "manual", kind: "note", panel: target.panel ?? null, balloon: target.balloon ?? null, page: target.page ?? null, speaker: null, from: null, to: text, source_line: null }],
      by: "autore",
      at: new Date().toISOString(),
      again: true,
    });

  return (
    <>
      <div className="area editor" hidden={area !== "pagine"}>
        <aside className="col editor__nav">
          <p className="eyebrow">Pagine</p>
          <PageList chapterId={chapter.id} pages={pages} currentPageId={page.id} sceneId={scene.id} onSelectPage={goToPage} run={run} openRevisions={openBy} />
          <NoteButton what="la pagina" onAdd={(text) => annotate({ page: page.id }, text)} open={openBy.get(page.id) ?? 0} onShow={() => showRevisions(page.id)} />
          <p className="page-meta">
            <strong>{page.layout.mode === "page" ? page.layout.template_id : "strip"}</strong> · {page.panels.length} vignette
          </p>

          <p className="eyebrow">Vignette</p>
          <ul className="panel-list">
            {page.panels.map((panel) => {
              const level = badges.get(panel.id);
              return (
                <li key={panel.id}>
                  <button type="button" className="panel-row" aria-current={panel.id === selectedPanel.id} onClick={() => selectPanel(panel.id)} title={panel.id}>
                    <span className="panel-row__num">{panelNumber(panel.id)}</span>
                    <span className="panel-row__main">
                      <span className="panel-row__shot">
                        <span className="panel-row__code">{panel.camera.shot}</span> {SHOT_LABELS[panel.camera.shot]}
                      </span>
                      <span className="panel-row__action">{panel.action || "—"}</span>
                    </span>
                    <span className="panel-row__badges">
                      {panel.balloons.length > 0 && <span className="panel-row__count" title={`${panel.balloons.length} balloon`}>{panel.balloons.length}</span>}
                      {openBy.has(panel.id) && <span className="panel-row__notes" title={`${openBy.get(panel.id)} revisioni aperte`}>✎{openBy.get(panel.id)}</span>}
                      {level && <span className={`dot dot--${level}`} title={`${level} su questa vignetta`} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="canvas">
          <div className="canvas__bar">
            <p className="canvas__title">
              {view === "page" ? `Pagina ${page.order}` : "Striscia dell'episodio"}
              <span className="muted"> · {pages.length} in tutto</span>
            </p>
            <div className="segmented" role="group" aria-label="Formato mostrato">
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
                  title={`${t.id} — ${t.primary ? "formato principale: qui si ritocca tutto" : "qui si spostano solo i balloon, per questo formato"}`}
                >
                  {targetLabel(t.id)}
                </button>
              ))}
              <button
                type="button"
                className="seg"
                aria-pressed={view === "scroll"}
                onClick={() => setView("scroll")}
                disabled={!stripTargetId}
                title={stripTargetId ? `${stripTargetId} — la striscia come la leggerà il telefono, con i tagli` : "Il progetto non ha un formato a striscia"}
              >
                {stripTargetId ? targetLabel(stripTargetId) : "Striscia"}
              </button>
            </div>
            {view === "page" && (
              <div className="segmented" role="group" aria-label="Dimensione della pagina">
                <button type="button" className="seg" aria-pressed={fit === "page"} onClick={() => setFit("page")} title="La pagina intera, sempre in vista">
                  adatta
                </button>
                <button type="button" className="seg" aria-pressed={fit === "width"} onClick={() => setFit("width")} title="Larga quanto la colonna: più grande, si scorre">
                  larghezza
                </button>
              </div>
            )}
          </div>

          <div
            className={`canvas__stage canvas__stage--${view === "scroll" ? "strip" : fit}`}
            style={preview ? ({ "--page-ratio": preview.width / preview.height } as React.CSSProperties) : undefined}
          >
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
                  selectBalloon(balloonId);
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
                  selectBalloon(balloonId);
                }}
                run={run}
                endGesture={endGesture}
                staleNote={schemaIssues.length > 0}
                onDropFiles={(files, panelId) => void dropArt(files, panelId)}
                framingPanelId={framing ? selectedPanel.id : null}
              />
            )}
            {fontError && <p className="preview__note">Font non caricato: {fontError}</p>}
            {!font && !fontError && <p className="muted">Carico il font…</p>}
          </div>

          <div className="canvas__foot">
            {view === "page" && dropNote && <p className="issue issue--info">{dropNote}</p>}
            {view === "page" && (
              <p className="field__hint">
                {framing
                  ? "Inquadratura dell'arte: trascina per spostarla, rotella per ingrandirla."
                  : pageTargetId === primaryTarget.id
                    ? "Trascina balloon, punta della coda e gutter · trascina un'immagine su una vignetta per dargliela · Ctrl+Z annulla."
                    : `In ${targetLabel(pageTargetId)} si spostano solo i balloon, e solo per questo formato. Griglia e vignette si ritoccano sul formato principale.`}
              </p>
            )}
            <Section
              id="validation"
              className="drawer"
              title={
                <>
                  Validazione <LevelCounts counts={pageCounts} />
                </>
              }
            >
              <ValidationPanel schemaIssues={schemaIssues} docIssues={pageIssues} onSelectPanel={selectPanel} knownPanelIds={panelIds} />
            </Section>
          </div>
        </section>

        <aside className="col col--work editor__inspector">
          <div className="inspector__head">
            <p className="inspector__title">
              Vignetta {panelNumber(selectedPanel.id)} <span className="muted">di {page.panels.length}</span>
            </p>
            <span className="panel-id">{selectedPanel.id}</span>
          </div>
          <Tabs<InspectorTab>
            label="Cosa si modifica della vignetta"
            className="tabs--fill"
            value={inspectorTab}
            onChange={setInspectorTab}
            items={[
              { id: "vignetta", label: "Vignetta", title: "Azione, inquadratura, griglia, personaggi" },
              { id: "balloon", label: "Balloon", badge: selectedPanel.balloons.length, title: "Testi, posizione e coda" },
              { id: "arte", label: "Arte", title: "Immagine della vignetta, generazione e istruzioni per un modello esterno" },
            ]}
          />

          <div className="stack" role="tabpanel" hidden={inspectorTab !== "vignetta"}>
            <div className="card">
              <div className="stack">
                <label className="field">
                  <span className="field__label">azione</span>
                  <textarea value={selectedPanel.action} rows={3} onChange={(e) => patchPanel("action", e.target.value)} onBlur={endGesture} />
                  <span className="field__hint">Per chi disegna è la specifica della vignetta, non una nota.</span>
                </label>

                <label className="field">
                  <span className="field__label">luogo e ora</span>
                  <input type="text" value={selectedPanel.setting} onChange={(e) => patchPanel("setting", e.target.value)} onBlur={endGesture} />
                </label>
              </div>
            </div>

            <NoteButton
              what="la vignetta"
              onAdd={(text) => annotate({ panel: selectedPanel.id }, text)}
              open={openBy.get(selectedPanel.id) ?? 0}
              onShow={() => showRevisions(selectedPanel.id)}
            />

            <PanelTools page={page} panel={selectedPanel} run={run} onSelectPanel={selectPanel} />

            <PanelCharacters pageId={page.id} panel={selectedPanel} refs={refs} sheets={doc.characters} run={run} endGesture={endGesture} />

            <Section id="camera" className="card" title="camera completa">
              <CameraForm camera={selectedPanel.camera} onChange={(camera) => run({ type: "panel.camera", pageId: page.id, panelId: selectedPanel.id, camera })} />
            </Section>
          </div>

          <div className="stack" role="tabpanel" hidden={inspectorTab !== "balloon"}>
            {selectedPanel.balloons.length === 0 && <p className="empty">Questa vignetta non ha balloon.</p>}
            {selectedPanel.balloons.map((balloon) => (
              <BalloonEditor
                key={balloon.id}
                onAnnotate={(text) => annotate({ panel: selectedPanel.id, balloon: balloon.id }, text)}
                balloon={balloon}
                selected={balloon.id === selectedBalloonId}
                onSelect={() => setSelectedBalloonId(balloon.id)}
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
            <button type="button" className="btn btn--small" onClick={() => run({ type: "balloon.add", pageId: page.id, panelId: selectedPanel.id, text: [{ t: "Nuovo balloon" }] })}>
              + balloon
            </button>
          </div>

          <div className="stack" role="tabpanel" hidden={inspectorTab !== "arte"}>
            <ArtCard
              pageId={page.id}
              panel={selectedPanel}
              store={editor.assets}
              inMemory={editor.store === null}
              url={art.urls.get(selectedPanel.id)}
              run={run}
              endGesture={endGesture}
              scan={art.scan}
              framing={framing}
              onToggleFraming={() => {
                setFraming((v) => !v);
                setView("page");
              }}
            />

            <GenerateCard
              config={image}
              store={editor.assets}
              project={doc.project}
              characters={doc.characters}
              pageId={page.id}
              panel={selectedPanel}
              items={generation}
              primaryLabel={targetLabel(primaryTarget.id)}
              run={run}
              endGesture={endGesture}
            />

            {selectedBrief && briefs && (
              <PromptCard brief={selectedBrief} pageBrief={briefs.page} panel={selectedPanel} pageId={page.id} project={doc.project} run={run} endGesture={endGesture} />
            )}
          </div>
        </aside>
      </div>

      <div className="area area--scroll" hidden={area !== "revisioni"}>
        <div className="area__inner">
          <header className="area__head">
            <h2 className="area__title">Revisioni</h2>
            <p className="area__lead">
              Capitolo {chapter.number} · {openRevisions === 0 ? "nessuna correzione aperta" : openRevisions === 1 ? "1 correzione aperta" : `${openRevisions} correzioni aperte`}. Accettare una
              correzione riscrive solo i balloon coinvolti.
            </p>
          </header>
          <RevisionsPanel doc={doc} chapterId={chapter.id} run={run} endGesture={endGesture} onSelectPanel={revealPanel} write={async (files) => (await platform.write(files)).destination} filter={revisionFilter} onClearFilter={() => setRevisionFilter(null)} />
        </div>
      </div>

      <div className="area area--scroll" hidden={area !== "export"}>
        <div className="area__inner area__inner--split">
          <div>
            <header className="area__head">
              <h2 className="area__title">Export</h2>
              <p className="area__lead">Il capitolo {chapter.number} intero, in tutti i formati scelti, dallo stesso documento.</p>
            </header>
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
          </div>
          <div className="card">
            <p className="card__title">prima di esportare</p>
            <p className="field__hint">Cosa segnala il controllo, pagina per pagina. Un clic porta alla pagina.</p>
            <ul className="check-list">
              {chapterCheck?.map(({ page: p, counts }) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="check-row"
                    onClick={() => {
                      goToPage(p.id);
                      onArea("pagine");
                    }}
                  >
                    <span className="check-row__page">Pagina {p.order}</span>
                    <LevelCounts counts={counts} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
