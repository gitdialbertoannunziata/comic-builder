import { useEffect, useRef, useState } from "react";
import { chapterContext, issue, lessonsOnlyIn, locationRef, nextChapterId, projectDocFrom, type Page } from "@comic-builder/core";
import { describeLocations, type PlaceToDescribe, type BreakdownProgress } from "@comic-builder/llm";
import { useFont } from "./useFont.js";
import { llmServiceFor, runBreakdown, type LlmChoice } from "./runBreakdown.js";
import { initialPages, initialScene, SAMPLE_SCRIPT } from "./samplePage.js";
import { useArtWatcher } from "./editor/useArtWatcher.js";
import { useRenders } from "./editor/useRenders.js";
import type { ImageConfig } from "./components/GenerateCard.js";
import { ChapterBar } from "./components/ChapterBar.js";
import { BreakdownContext } from "./components/BreakdownContext.js";
import { ReferencesArea, type ReferencesTab } from "./components/ReferencesArea.js";
import { ScriptPanel, type ServiceChoice, type BreakdownSummary } from "./components/ScriptPanel.js";
import { BrowserPlatformService } from "./platform/browserPlatform.js";
import { prefilledConfig } from "./devConfig.js";
import { project } from "./project.js";
import { useProjectEditor } from "./editor/useProjectEditor.js";
import { ProjectBar } from "./components/ProjectBar.js";
import { Workspace, type Area } from "./components/Workspace.js";
import { usePreference } from "./usePreference.js";
import { useSecret } from "./platform/desktop.js";
import { focusCanvas, isTyping, LIST_LEGEND, useLegend, useShortcuts } from "./keyboard.js";
import { ShortcutsHelp } from "./components/ShortcutsHelp.js";
import { LocalModelsDialog } from "./components/LocalModelsDialog.js";
import { ConfigurationDialog } from "./components/ConfigurationDialog.js";
import { installedModel, local, onOpenLocalModels, useLocalModels } from "./platform/localModels.js";
import { useGeneration } from "./useGeneration.js";
import { GenerationQueues } from "./components/GenerationQueues.js";

/** Un solo servizio per tutta la sessione: la cartella scelta dall'utente dev'essere ricordata. */
const platform = new BrowserPlatformService();

/** Le aree nell'ordine della barra: i tasti 1…5. */
const AREAS: readonly Area[] = ["copione", "pagine", "personaggi", "revisioni", "export"];

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


/**
 * L'opera: capitoli, copione e spoglio. Ciò che riguarda un capitolo aperto
 * — pagine, pannelli, anteprima, revisioni, export — sta nel Workspace, che
 * esiste solo se il capitolo ha pagine e riparte da capo cambiando capitolo.
 */
export function App() {
  const editor = useProjectEditor(initialDoc);
  const { doc, run, endGesture } = editor;
  const watched = useArtWatcher(editor.assets, doc, run, endGesture);
  // Arte dell'autore e render insieme: chi disegna la pagina non distingue.
  const art = useRenders(editor.assets, doc, watched);
  const chapters = doc.chapters.chapters;
  // Il capitolo aperto, per progetto: dopo un F5 si riparte da lì.
  const [chapterId, setChapterId] = usePreference(`chapter:${doc.project.id}`, chapters[0]!.id);
  const [area, setArea] = usePreference<Area>("area", "pagine");
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0]!;
  const pages = chapter.pages.map((id) => doc.pages[id]).filter((p): p is Page => p !== undefined);

  // Il copione che si sta scrivendo, per capitolo: finché non si spoglia è
  // una bozza della scheda; spogliato, diventa il copione del capitolo.
  // Chiave per progetto e capitolo: un progetto nuovo non eredita la bozza del precedente.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = `${doc.project.id}:${chapter.id}`;
  const script = drafts[draftKey] ?? doc.scripts[chapter.id] ?? "";
  const setScript = (text: string) => setDrafts((d) => ({ ...d, [draftKey]: text }));
  const latest = useRef({ doc, drafts, assets: editor.assets, chapterId: chapter.id });
  latest.current = { doc, drafts, assets: editor.assets, chapterId: chapter.id };
  const breakdown = useGeneration(editor.assets, doc.project.id);

  // Il nome del progetto anche nella scheda del browser.
  useEffect(() => {
    document.title = `${doc.project.title} — comic-builder`;
  }, [doc.project.title]);
  const [service, setService] = usePreference<ServiceChoice>(
    "service",
    prefilled.anthropicKeyFromEnv ? "anthropic" : prefilled.deepseekKeyFromEnv ? "deepseek" : prefilled.openaiKeyFromEnv ? "openai" : "mock",
  );
  const [ollamaModel, setOllamaModel] = usePreference("ollamaModel", prefilled.ollamaModel);
  const [ollamaHost, setOllamaHost] = usePreference("ollamaHost", prefilled.ollamaHost);
  // Nell'app desktop le chiavi si ritrovano al prossimo avvio, cifrate; nel browser restano nella scheda.
  const [anthropicKey, setAnthropicKey] = useSecret("anthropic", prefilled.anthropicKey);
  const [anthropicModel, setAnthropicModel] = usePreference("anthropicModel", prefilled.anthropicModel);
  const [deepseekKey, setDeepseekKey] = useSecret("deepseek", prefilled.deepseekKey);
  const [deepseekModel, setDeepseekModel] = usePreference("deepseekModel", prefilled.deepseekModel);
  const [openaiKey, setOpenaiKey] = useSecret("openai", prefilled.openaiKey);
  const [openaiModel, setOpenaiModel] = usePreference("openaiModel", prefilled.openaiModel);
  const [openaiBaseUrl, setOpenaiBaseUrl] = usePreference("openaiBaseUrl", prefilled.openaiBaseUrl);
  const [imageService, setImageService] = usePreference<ImageConfig["service"]>("imageService", prefilled.azureFluxKeyFromEnv || !prefilled.bflKeyFromEnv ? "azure" : "flux");
  const [bflKey, setBflKey] = useSecret("bfl", prefilled.bflKey);
  const [bflModel, setBflModel] = usePreference("bflModel", prefilled.bflModel);
  const [bflBaseUrl, setBflBaseUrl] = usePreference("bflBaseUrl", prefilled.bflBaseUrl);
  const [azureFluxKey, setAzureFluxKey] = useSecret("azure-flux", prefilled.azureFluxKey);
  const [azureFluxEndpoint, setAzureFluxEndpoint] = usePreference("azureFluxEndpoint", prefilled.azureFluxEndpoint);
  const [azureFluxDeployment, setAzureFluxDeployment] = usePreference("azureFluxDeployment", prefilled.azureFluxDeployment);
  const [megapixels, setMegapixels] = usePreference("imageMegapixels", 1);
  const [localImageUrl, setLocalImageUrl] = usePreference("localImageUrl", "http://127.0.0.1:1234");
  // I modelli locali dell'app desktop: installati dalla procedura guidata, avviati dall'app.
  const localModels = useLocalModels();
  const [localDialog, setLocalDialog] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  useEffect(() => onOpenLocalModels(() => setLocalDialog(true)), []);
  const image: ImageConfig = {
    service: imageService,
    onService: setImageService,
    apiKey: bflKey,
    onApiKey: setBflKey,
    keyFromEnv: prefilled.bflKeyFromEnv,
    model: bflModel,
    onModel: setBflModel,
    baseUrl: bflBaseUrl,
    azureKey: azureFluxKey,
    onAzureKey: setAzureFluxKey,
    azureKeyFromEnv: prefilled.azureFluxKeyFromEnv,
    azureEndpoint: azureFluxEndpoint,
    onAzureEndpoint: setAzureFluxEndpoint,
    azureDeployment: azureFluxDeployment,
    onAzureDeployment: setAzureFluxDeployment,
    megapixels,
    onMegapixels: setMegapixels,
    localUrl: localImageUrl,
    onLocalUrl: setLocalImageUrl,
    localManaged: local !== null,
    localModel: installedModel(localModels, "image")?.label ?? null,
  };
  const llm: LlmChoice = { service, ollamaModel, ollamaHost, anthropicKey, anthropicModel, deepseekKey, deepseekModel, openaiKey, openaiModel, openaiBaseUrl };
  const textModel = service === "local" ? installedModel(localModels, "text")?.label ?? "locale" : service === "mock" ? "euristico" : service === "ollama" ? ollamaModel : service === "anthropic" ? anthropicModel : service === "deepseek" ? deepseekModel : openaiModel;
  const describe = (places: readonly PlaceToDescribe[]) => describeLocations({ llm: llmServiceFor(llm), places, notes: doc.project.series_notes });

  // L'area Riferimenti: quale scheda, e cosa aprire quando ci si arriva da una vignetta.
  const [referencesTab, setReferencesTab] = usePreference<ReferencesTab>("referencesTab", "stile");
  const [referencesFocus, setReferencesFocus] = useState<{ ref: string; at: number } | null>(null);
  const openReferences = (tab: ReferencesTab, ref?: string) => {
    setReferencesTab(tab);
    if (ref) setReferencesFocus({ ref, at: Date.now() });
    setArea("personaggi");
  };

  const running = breakdown.phase !== null;
  const [breakdownProgress, setBreakdownProgress] = useState<BreakdownProgress | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BreakdownSummary | null>(null);
  useEffect(() => { setSummary(null); setBreakdownError(null); setBreakdownProgress(null); }, [editor.assets, doc.project.id]);

  const { font, bytes: fontBytes, error: fontError } = useFont("/fonts/ComicNeue-Regular.ttf");

  async function onRunBreakdown() {
    if (running) return;
    setBreakdownError(null);
    const unchanged = () => {
      const now = latest.current;
      const target = now.doc.chapters.chapters.find((entry) => entry.id === chapter.id);
      return now.assets === editor.assets && now.doc.project.id === doc.project.id && target === chapter
        && (now.drafts[draftKey] ?? now.doc.scripts[chapter.id] ?? "") === script
        && chapter.pages.every((id) => now.doc.pages[id] === doc.pages[id]);
    };
    try {
      const result = await breakdown.schedule(llm.service, "text", `Spoglio ${chapter.title} · ${llm.service}/${textModel}`, (_signal, isCurrent) => runBreakdown({
        script,
        ...llm,
        chapterId: chapter.id,
        // Gli altri capitoli: personaggi esistenti e riassunto del precedente.
        context: chapterContext(doc, chapter.id),
        onProgress: (progress) => { if (isCurrent()) setBreakdownProgress(progress); },
      }), unchanged);
      if (!unchanged()) throw new Error("Il copione o le pagine sono cambiati durante lo spoglio. I risultati non sono stati applicati: rilancia il lavoro.");
      if (result.pages.length === 0) throw new Error("Lo spoglio non ha prodotto pagine.");
      // Lo spoglio riempie il capitolo aperto e basta: gli altri restano come
      // sono. È un passo della cronologia: Ctrl+Z riporta il capitolo di prima.
      const gesture = `breakdown-${chapter.id}-${Date.now()}`;
      run({ type: "chapter.set-content", chapterId: chapter.id, pages: result.pages, scenes: result.scenes, script }, { gesture });
      // Chi compare entra fra i personaggi con ciò che il testo ne dice. Di
      // una scheda che c'è già si riempiono solo i campi vuoti: ciò che
      // l'autore ha scritto resta suo.
      const filled: string[] = [];
      for (const member of result.cast) {
        const sheet = latest.current.doc.characters[member.ref];
        const appearance = Object.fromEntries(Object.entries(member.appearance).filter(([key, value]) => value && !sheet?.appearance[key as keyof typeof member.appearance]?.trim()));
        const patch = {
          ...(!sheet?.name.trim() ? { name: member.name } : {}),
          ...(member.summary && !sheet?.summary.trim() ? { summary: member.summary } : {}),
          ...(Object.keys(appearance).length > 0 ? { appearance } : {}),
        };
        if (sheet && Object.keys(patch).length === 0) continue;
        run({ type: "character.upsert", ref: member.ref, patch }, { gesture });
        filled.push(sheet?.name.trim() || member.name);
      }
      // I luoghi lo stesso: una scheda che non c'è nasce con la descrizione proposta, una che c'è prende solo quella che le manca.
      const places: string[] = [];
      for (const place of result.locations) {
        const ref = locationRef(place.name);
        const sheet = latest.current.doc.locations[ref];
        if (!ref || !place.description || sheet?.description.trim()) continue;
        run({ type: "location.upsert", ref, patch: sheet ? { description: place.description } : { name: place.name, description: place.description } }, { gesture });
        places.push(place.name);
      }
      if (!chapter.title.trim() || /^Capitolo \d+$/.test(chapter.title)) {
        run({ type: "chapter.update", chapterId: chapter.id, title: result.scenes[0]?.title ?? chapter.title }, { gesture });
      }
      endGesture();
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([key]) => key !== draftKey)));
      setSummary({
        ...result.summary,
        issues: [
          ...result.summary.issues,
          ...(filled.length > 0 ? [issue("info", "breakdown.cast-added", `Schede personaggio riempite dallo spoglio (dove il testo tace è una proposta), da rivedere: ${filled.join(", ")}`, "characters")] : []),
          ...(places.length > 0 ? [issue("info", "breakdown.locations-added", `Luoghi descritti dallo spoglio, da rivedere in Riferimenti → Luoghi: ${places.join(", ")}`, "locations")] : []),
        ],
      });
      // Le pagine sono nate: si va a vederle. L'esito resta nell'area Copione.
      if (latest.current.chapterId === chapter.id) setArea("pagine");
    } catch (error) {
      if (!breakdown.isCurrent()) return;
      setBreakdownError(error instanceof Error ? error.message : String(error));
      setSummary(null);
    } finally {
      if (breakdown.isCurrent()) setBreakdownProgress(null);
    }
  }

  /** Un capitolo ancora senza pagine si apre sul copione: è da lì che nascono. */
  function selectChapter(id: string) {
    setChapterId(id);
    const next = chapters.find((c) => c.id === id);
    if (!next || next.pages.length === 0) setArea("copione");
  }

  const openRevisions = (doc.revisions[chapter.id]?.entries ?? []).filter((e) => e.status === "open").length;

  const [help, setHelp] = useState(false);
  function stepChapter(step: 1 | -1) {
    const ordered = [...chapters].sort((a, b) => a.number - b.number);
    const next = ordered[ordered.findIndex((c) => c.id === chapter.id) + step];
    if (next) selectChapter(next.id);
  }
  useShortcuts("Ovunque", 0, [
    { keys: ["?"], label: "Questa legenda", once: true, run: () => setHelp((open) => !open) },
    { keys: ["1", "2", "3", "4", "5"], shown: "1 … 5", label: "Aree: Copione, Pagine, Riferimenti, Revisioni, Export", once: true, run: (e) => setArea(AREAS[Number(e.key) - 1]!) },
    { keys: ["Shift+PageUp", "Shift+PageDown"], shown: "Shift + Pag↑ / Pag↓", label: "Capitolo precedente / successivo", once: true, run: (e) => stepChapter(e.key === "PageDown" ? 1 : -1) },
    {
      keys: ["Escape"],
      label: "Esce dal campo in cui scrivi: da lì i tasti sono comandi",
      when: "always",
      run: (e) => {
        if (!isTyping(e.target)) return false;
        (e.target as HTMLElement).blur();
        focusCanvas();
      },
    },
    // Annulla, ripeti e salva li gestisce l'editor (useProjectEditor), anche dentro i campi: qui solo la voce.
    { keys: ["Mod+z"], label: "Annulla" },
    { keys: ["Mod+Shift+z"], label: "Ripeti" },
    { keys: ["Mod+s"], label: "Salva" },
    // Alt+← nel browser è «indietro»: qui Alt+frecce sposta code, pagine e capitoli, e un colpo
    // a vuoto non deve portare fuori dallo strumento. Dentro un campo resta del sistema.
    { keys: ["Alt+ArrowLeft", "Alt+ArrowRight"], run: () => {} },
  ]);
  useLegend("In un elenco", 30, LIST_LEGEND);

  return (
    <div className="shell">
      <div className="shell__bar">
        <ProjectBar
          editor={editor}
          chapters={chapters}
          chapterId={chapter.id}
          onSelectChapter={selectChapter}
          area={area}
          onArea={setArea}
          openRevisions={openRevisions}
          onHelp={() => setHelp(true)}
          onConfiguration={() => setConfigurationOpen(true)}
          {...(local ? { onLocalModels: () => setLocalDialog(true) } : {})}
        />
        <GenerationQueues />
      </div>
      <ShortcutsHelp open={help} onClose={() => setHelp(false)} />
      <ConfigurationDialog
        open={configurationOpen}
        onClose={() => setConfigurationOpen(false)}
        config={{ ...llm, bflKey, bflModel, bflBaseUrl, azureFluxKey, azureFluxEndpoint, azureFluxDeployment }}
        onChange={(field, value) => ({
          anthropicKey: setAnthropicKey,
          anthropicModel: setAnthropicModel,
          deepseekKey: setDeepseekKey,
          deepseekModel: setDeepseekModel,
          openaiKey: setOpenaiKey,
          openaiModel: setOpenaiModel,
          openaiBaseUrl: setOpenaiBaseUrl,
          ollamaHost: setOllamaHost,
          ollamaModel: setOllamaModel,
          bflKey: setBflKey,
          bflModel: setBflModel,
          bflBaseUrl: setBflBaseUrl,
          azureFluxKey: setAzureFluxKey,
          azureFluxEndpoint: setAzureFluxEndpoint,
          azureFluxDeployment: setAzureFluxDeployment,
        })[field](value)}
        service={service}
        onService={setService}
        imageService={imageService}
        onImageService={setImageService}
      />
      <LocalModelsDialog
        open={localDialog}
        onClose={() => setLocalDialog(false)}
        onUse={(use) => {
          if (use.text) setService("local");
          if (use.image) setImageService("local");
        }}
      />

      <div className="area area--scroll" hidden={area !== "copione"}>
        <div className="area__inner area__inner--script">
          <div>
            <header className="area__head">
              <h2 className="area__title">Copione</h2>
              <p className="area__lead">
                Il testo del capitolo {chapter.number}. Lo spoglio lo divide in scene, pagine e vignette{pages.length > 0 ? "; rifarlo sostituisce le pagine del capitolo (Ctrl+Z le riporta)" : ""}.
              </p>
            </header>
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
              openaiKey={openaiKey}
              onOpenaiKeyChange={setOpenaiKey}
              openaiModel={openaiModel}
              onOpenaiModelChange={setOpenaiModel}
              openaiBaseUrl={openaiBaseUrl}
              onOpenaiBaseUrlChange={setOpenaiBaseUrl}
              openaiKeyFromEnv={prefilled.openaiKeyFromEnv}
              onRun={() => void onRunBreakdown()}
              running={running}
              queued={breakdown.phase === "queued"}
              progress={breakdownProgress}
              error={breakdownError}
              summary={summary}
            />
          </div>
          <div className="stack">
            <div className="card">
              <p className="card__title">capitoli dell'opera</p>
              <ChapterBar
                chapters={chapters}
                currentId={chapter.id}
                onSelect={selectChapter}
                run={run}
                endGesture={endGesture}
                nextId={nextChapterId(doc).id}
                content={{ script: script.trim().length > 0, revisions: doc.revisions[chapter.id]?.entries.length ?? 0, lessons: lessonsOnlyIn(doc, chapter.id).length }}
              />
            </div>
            <div className="card">
              <p className="card__title">cosa sa lo spoglio</p>
              <BreakdownContext doc={doc} chapterId={chapter.id} script={script} run={run} endGesture={endGesture} />
            </div>
          </div>
        </div>
      </div>

      <div className="area area--scroll" hidden={area !== "personaggi"}>
        <div className="area__inner">
          <ReferencesArea
            doc={doc}
            store={editor.assets}
            image={image}
            run={run}
            endGesture={endGesture}
            tab={referencesTab}
            onTab={setReferencesTab}
            focus={referencesFocus}
            describe={describe}
            describer={textModel}
            describeService={service}
          />
        </div>
      </div>

      {pages.length > 0 ? (
        <Workspace
          key={chapter.id}
          editor={editor}
          art={art}
          platform={platform}
          image={image}
          chapter={chapter}
          pages={pages}
          font={font}
          fontBytes={fontBytes}
          fontError={fontError}
          area={area}
          onArea={setArea}
          onReferences={openReferences}
        />
      ) : (
        <div className="area area--empty" hidden={area === "copione" || area === "personaggi"}>
          <div className="empty-chapter">
            <p className="eyebrow">Capitolo {chapter.number} — vuoto</p>
            <p>Questo capitolo non ha ancora pagine: nascono dallo spoglio del copione.</p>
            <button type="button" className="btn btn--primary" onClick={() => setArea("copione")}>
              Vai al copione
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
