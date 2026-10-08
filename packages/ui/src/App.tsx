import { useEffect, useState } from "react";
import { chapterContext, issue, nextChapterId, projectDocFrom, type Page } from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { runBreakdown } from "./runBreakdown.js";
import { initialPages, initialScene, SAMPLE_SCRIPT } from "./samplePage.js";
import { useArtWatcher } from "./editor/useArtWatcher.js";
import { useRenders } from "./editor/useRenders.js";
import type { ImageConfig } from "./components/GenerateCard.js";
import { ChapterBar } from "./components/ChapterBar.js";
import { BreakdownContext } from "./components/BreakdownContext.js";
import { CharactersPanel } from "./components/CharactersPanel.js";
import { ScriptPanel, type ServiceChoice, type BreakdownSummary } from "./components/ScriptPanel.js";
import { BrowserPlatformService } from "./platform/browserPlatform.js";
import { prefilledConfig } from "./devConfig.js";
import { project } from "./project.js";
import { useProjectEditor } from "./editor/useProjectEditor.js";
import { ProjectBar } from "./components/ProjectBar.js";
import { Workspace, type Area } from "./components/Workspace.js";
import { usePreference } from "./usePreference.js";

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
  const [anthropicKey, setAnthropicKey] = useState(prefilled.anthropicKey);
  const [anthropicModel, setAnthropicModel] = usePreference("anthropicModel", prefilled.anthropicModel);
  const [deepseekKey, setDeepseekKey] = useState(prefilled.deepseekKey);
  const [deepseekModel, setDeepseekModel] = usePreference("deepseekModel", prefilled.deepseekModel);
  const [openaiKey, setOpenaiKey] = useState(prefilled.openaiKey);
  const [openaiModel, setOpenaiModel] = usePreference("openaiModel", prefilled.openaiModel);
  const [openaiBaseUrl, setOpenaiBaseUrl] = usePreference("openaiBaseUrl", prefilled.openaiBaseUrl);
  const [imageService, setImageService] = usePreference<ImageConfig["service"]>("imageService", prefilled.azureFluxKeyFromEnv || !prefilled.bflKeyFromEnv ? "azure" : "flux");
  const [bflKey, setBflKey] = useState(prefilled.bflKey);
  const [bflModel, setBflModel] = usePreference("bflModel", prefilled.bflModel);
  const [azureFluxKey, setAzureFluxKey] = useState(prefilled.azureFluxKey);
  const [azureFluxEndpoint, setAzureFluxEndpoint] = usePreference("azureFluxEndpoint", prefilled.azureFluxEndpoint);
  const [azureFluxDeployment, setAzureFluxDeployment] = usePreference("azureFluxDeployment", prefilled.azureFluxDeployment);
  const [megapixels, setMegapixels] = usePreference("imageMegapixels", 1);
  const image: ImageConfig = {
    service: imageService,
    onService: setImageService,
    apiKey: bflKey,
    onApiKey: setBflKey,
    keyFromEnv: prefilled.bflKeyFromEnv,
    model: bflModel,
    onModel: setBflModel,
    baseUrl: prefilled.bflBaseUrl,
    azureKey: azureFluxKey,
    onAzureKey: setAzureFluxKey,
    azureKeyFromEnv: prefilled.azureFluxKeyFromEnv,
    azureEndpoint: azureFluxEndpoint,
    onAzureEndpoint: setAzureFluxEndpoint,
    azureDeployment: azureFluxDeployment,
    onAzureDeployment: setAzureFluxDeployment,
    megapixels,
    onMegapixels: setMegapixels,
  };
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
        openaiKey,
        openaiModel,
        openaiBaseUrl,
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
      // Chi compare entra fra i personaggi con ciò che il testo ne dice. Di
      // una scheda che c'è già si riempiono solo i campi vuoti: ciò che
      // l'autore ha scritto resta suo.
      const filled: string[] = [];
      for (const member of result.cast) {
        const sheet = doc.characters[member.ref];
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
      if (!chapter.title.trim() || /^Capitolo \d+$/.test(chapter.title)) {
        run({ type: "chapter.update", chapterId: chapter.id, title: result.scenes[0]?.title ?? chapter.title }, { gesture });
      }
      endGesture();
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([key]) => key !== draftKey)));
      setSummary(
        filled.length > 0
          ? {
              ...result.summary,
              issues: [
                ...result.summary.issues,
                issue("info", "breakdown.cast-added", `Schede personaggio riempite dallo spoglio (dove il testo tace è una proposta), da rivedere: ${filled.join(", ")}`, "characters"),
              ],
            }
          : result.summary,
      );
      // Le pagine sono nate: si va a vederle. L'esito resta nell'area Copione.
      setArea("pagine");
    } catch (error) {
      setBreakdownError(error instanceof Error ? error.message : String(error));
      setSummary(null);
    } finally {
      setRunning(false);
      setBreakdownProgress(null);
    }
  }

  /** Un capitolo ancora senza pagine si apre sul copione: è da lì che nascono. */
  function selectChapter(id: string) {
    setChapterId(id);
    const next = chapters.find((c) => c.id === id);
    if (!next || next.pages.length === 0) setArea("copione");
  }

  const openRevisions = (doc.revisions[chapter.id]?.entries ?? []).filter((e) => e.status === "open").length;

  return (
    <div className="shell">
      <ProjectBar editor={editor} chapters={chapters} chapterId={chapter.id} onSelectChapter={selectChapter} area={area} onArea={setArea} openRevisions={openRevisions} />

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
              progress={breakdownProgress}
              error={breakdownError}
              summary={summary}
            />
          </div>
          <div className="stack">
            <div className="card">
              <p className="card__title">capitoli dell'opera</p>
              <ChapterBar chapters={chapters} currentId={chapter.id} onSelect={selectChapter} run={run} endGesture={endGesture} nextId={nextChapterId(doc).id} />
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
          <header className="area__head">
            <h2 className="area__title">Personaggi</h2>
            <p className="area__lead">Sono dell'opera, non del capitolo: com'è fatto ognuno si dice qui una volta, e vale in ogni vignetta.</p>
          </header>
          <CharactersPanel doc={doc} store={editor.assets} image={image} run={run} endGesture={endGesture} />
        </div>
      </div>

      {pages.length > 0 ? (
        <Workspace key={chapter.id} editor={editor} art={art} platform={platform} image={image} chapter={chapter} pages={pages} font={font} fontBytes={fontBytes} fontError={fontError} area={area} onArea={setArea} />
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
