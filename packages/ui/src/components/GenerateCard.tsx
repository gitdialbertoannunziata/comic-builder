import { formatUsd as usd, t } from "../i18n.js";
import { useEffect, useState } from "react";
import {
  FLUX2_FLEX,
  FLUX2_KLEIN_4B,
  FLUX2_PRO,
  panelSeed,
  renderState,
  sceneLocation,
  STYLE_PRESETS,
  styleChosen,
  type CharacterSheet,
  type Command,
  type LocationSheet,
  type Panel,
  type Project,
  type ProjectStore,
  type ReferenceKind,
  type Scene,
} from "@comic-builder/core";
import {
  AZURE_FLUX_DEPLOYMENT,
  AZURE_FLUX_FLEX_DEPLOYMENT,
  AzureFluxImageService,
  azureFluxModel,
  estimateQueue,
  FluxImageService,
  LocalSdImageService,
  MockImageService,
  type ImageService,
} from "@comic-builder/image";
import { generatePanels, promoteRender, type GenerationItem, type GenerationReport } from "../editor/generateArt.js";
import { usePreference } from "../usePreference.js";
import type { ReferencesTab } from "./ReferencesArea.js";
import { desktop, networkFetch, useKeyNote } from "../platform/desktop.js";
import { local, openLocalModels } from "../platform/localModels.js";
import { useGeneration } from "../useGeneration.js";

/** Come si genera: scelto una volta per la sessione, vale per tutti i capitoli. */
export interface ImageConfig {
  service: "azure" | "flux" | "local" | "mock";
  onService: (service: ImageConfig["service"]) => void;
  apiKey: string;
  onApiKey: (key: string) => void;
  keyFromEnv: boolean;
  model: string;
  onModel: (model: string) => void;
  baseUrl: string;
  /** FLUX.2 distribuito su Azure AI Foundry: endpoint della risorsa, sua chiave, nome del deployment (da cui si riconosce il modello). */
  azureKey: string;
  onAzureKey: (key: string) => void;
  azureKeyFromEnv: boolean;
  azureEndpoint: string;
  onAzureEndpoint: (endpoint: string) => void;
  azureDeployment: string;
  onAzureDeployment: (deployment: string) => void;
  megapixels: number;
  onMegapixels: (megapixels: number) => void;
  /** Il motore locale: dove ascolta sd-server di stable-diffusion.cpp (nel browser, avviato a mano). */
  localUrl: string;
  onLocalUrl: (url: string) => void;
  /** Nell'app desktop il motore locale lo installa e lo avvia l'app: niente indirizzo da scrivere. */
  localManaged: boolean;
  /** Il modello delle immagini installato dalla procedura guidata; null se manca. */
  localModel: string | null;
}

/**
 * Il modello che finisce nello spec: col servizio finto non si registra un
 * render come se fosse di FLUX. Su Azure è il modello, non il nome del
 * deployment: lo stesso spec vale da qualunque fornitore arrivi l'immagine.
 */
export function specModel(config: ImageConfig): string {
  if (config.service === "mock") return "mock-image";
  if (config.service === "local") return FLUX2_KLEIN_4B;
  return config.service === "azure" ? azureFluxModel(config.azureDeployment) : config.model.trim() || FLUX2_PRO;
}

const MODEL_LABEL: Readonly<Record<string, string>> = { [FLUX2_PRO]: "FLUX.2 [pro]", [FLUX2_FLEX]: "FLUX.2 [flex]", [FLUX2_KLEIN_4B]: "FLUX.2 [klein] 4B" };

// Nessuno dei due fornitori abilita CORS: nel browser si passa dal server di sviluppo (vite.config.ts);
// nell'app desktop le chiamate le fa il processo principale, e il proxy non serve.
const viaProxy = desktop ? {} : { rewriteUrl: (url: string) => `/image-proxy/${url.replace(/^https:\/\//, "")}` };
// Il motore locale nemmeno, per quanto se ne sa: stesso server di sviluppo, solo verso questa macchina.
const viaLocalProxy = desktop ? {} : { rewriteUrl: (url: string) => `/local-image/${url.replace(/^http:\/\//, "")}` };

export function localService(config: ImageConfig): LocalSdImageService {
  // Nell'app desktop l'indirizzo lo dà il motore quando parte (e ferma quello dello spoglio): lo si chiede alla prima richiesta.
  if (config.localManaged && local) return new LocalSdImageService({ resolveBaseUrl: () => local!.start("image"), model: specModel(config), ...networkFetch });
  return new LocalSdImageService({ baseUrl: config.localUrl, model: specModel(config), ...viaLocalProxy, ...networkFetch });
}

export function makeService(config: ImageConfig): ImageService {
  if (config.service === "mock") return new MockImageService();
  if (config.service === "local") return localService(config);
  if (config.service === "azure") {
    return new AzureFluxImageService({ apiKey: config.azureKey, endpoint: config.azureEndpoint, deployment: config.azureDeployment, ...viaProxy, ...networkFetch });
  }
  return new FluxImageService({
    apiKey: config.apiKey,
    model: specModel(config),
    baseUrl: config.baseUrl,
    ...viaProxy,
    ...networkFetch,
  });
}

/** Se c'è quanto serve per chiamare il servizio scelto. */
export function serviceReady(config: ImageConfig): boolean {
  if (config.service === "mock") return true;
  if (config.service === "local") return config.localManaged ? config.localModel !== null : /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(config.localUrl.trim());
  return config.service === "azure" ? config.azureKey.trim().length > 0 && config.azureEndpoint.trim().length > 0 : config.apiKey.trim().length > 0;
}

interface Props {
  config: ImageConfig;
  store: ProjectStore;
  project: Project;
  characters: Readonly<Record<string, CharacterSheet>>;
  locations: Readonly<Record<string, LocationSheet>>;
  /** La scena del pannello: dice in che luogo è ambientato. */
  scene: Scene | undefined;
  pageId: string;
  pageNumber: number;
  panel: Panel;
  /** I pannelli della pagina coi loro spec; null se il formato mostrato non è quello su cui si genera. */
  items: readonly GenerationItem[] | null;
  isItemCurrent: (item: GenerationItem) => boolean;
  /** Etichetta del formato principale, per dire dove andare quando `items` è null. */
  primaryLabel: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Porta ai riferimenti dell'opera: lo stile, un luogo, un personaggio. */
  onReferences: (tab: ReferencesTab, ref?: string) => void;
}

const STATE_LABEL = { none: "mai generata", fresh: "aggiornata", stale: "da rigenerare: la vignetta è cambiata dopo il render" } as const;

/**
 * Arte generata (F3) con FLUX.2. Lo spec viene dal documento (§9.1):
 * qui si vede cosa partirà — riferimenti, spesa — e si decide quando. La
 * coerenza dei personaggi (F5) sta nei riferimenti delle schede: un render
 * riuscito si può tenere come riferimento, ed è così che la scheda cresce.
 */
export function GenerateCard({ config, store, project, characters, locations, scene, pageId, pageNumber, panel, items, isItemCurrent, primaryLabel, run, endGesture, onReferences }: Props) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<GenerationReport | null>(null);
  const [reportPage, setReportPage] = useState(pageNumber);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = usePreference("imageCapUsd", 2);
  const keyNote = useKeyNote();
  const generation = useGeneration(store, project.id);
  const busy = generation.phase !== null;
  useEffect(() => { setReport(null); setError(null); setProgress(null); setNote(null); }, [store, project.id]);

  const item = items?.find((i) => i.panel.id === panel.id) ?? null;
  const state = item ? renderState(panel, item.spec) : "none";
  const pending = (items ?? []).filter((i) => !i.panel.art.source && renderState(i.panel, i.spec) !== "fresh");
  const record = item ? panel.render[item.spec.target] : null;
  const ready = serviceReady(config);

  // La stima non ha bisogno della chiave: si vede quanto costa prima di metterla.
  const estimator: ImageService =
    config.service === "mock" ? new MockImageService() : config.service === "local" ? localService(config) : new FluxImageService({ apiKey: config.apiKey.trim() || "-", model: specModel(config) });
  const estimate = (list: readonly GenerationItem[]) => estimateQueue(estimator, list.map((i) => i.spec), config.service === "local" ? 1 : 2);

  async function generate(list: readonly GenerationItem[]) {
    if (list.length === 0 || busy) return;
    setError(null);
    setReport(null);
    setNote(null);
    const expected = estimate(list);
    if (expected.usd > cap) {
      setError(t("La stima ({0}) supera il tetto di spesa ({1}): alzalo qui sotto, o genera meno vignette.", usd(expected.usd), usd(cap)));
      return;
    }
    setProgress(null);
    setReportPage(pageNumber);
    try {
      setReport(await generation.schedule(config.service, "image", t("Pagina {0} · {1} vignette · {2}", pageNumber, list.length, config.service === "local" ? config.localModel ?? "locale" : specModel(config)), async (signal, isCurrent) => {
        setProgress({ done: 0, total: list.length });
        const targetValid = (entry: GenerationItem) => isCurrent() && isItemCurrent(entry);
        return generatePanels({
          store, service: makeService(config), items: list,
          run: (command, options) => isCurrent() && run(command, options),
          endGesture: () => { if (isCurrent()) endGesture(); },
          signal, concurrency: config.service === "local" ? 1 : 2,
          cancelInFlight: config.service !== "local",
          isValid: targetValid,
          onProgress: (progress) => { if (isCurrent()) setProgress(progress); },
        });
      }));
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation.isCurrent()) setProgress(null);
    }
  }

  /** Stessa vignetta, altro seed: l'epoca entra nel seed derivato (§5.7), e la variante di prima resta in `renders/`. */
  function variant() {
    if (!item) return;
    const seed = { ...panel.seed, epoch: panel.seed.epoch + 1 };
    run({ type: "panel.update", pageId, panelId: panel.id, patch: { seed } });
    const next = { ...panel, seed };
    void generate([{ pageId, panel: next, spec: { ...item.spec, seed: panelSeed(project, next) } }]);
  }

  const place = sceneLocation({ locations }, scene);

  /**
   * Curatela: un render riuscito diventa riferimento — dello stile dell'opera,
   * del luogo, di un personaggio. Le vignette che lo riceveranno risultano da
   * rigenerare: è voluto, ora hanno un riferimento in più.
   */
  async function keep(kind: ReferenceKind, ref: string) {
    if (!record) return;
    const directory = kind === "style" ? "style" : kind === "location" ? `locations/${ref}` : `characters/${ref}`;
    const path = await promoteRender(store, record.file, directory);
    if (!path) return setNote(t("Il file del render non c'è più: rigenera la vignetta."));
    const entry = { path, note: t("da {0}", panel.id), use: true };
    if (kind === "style") {
      if (!project.style.references.some((r) => r.path === path)) run({ type: "project.style", references: [...project.style.references, entry] });
      setNote(t("Tenuta come tavola di stile: da ora si allega a ogni generazione dell'opera, e tutte le vignette risultano da rigenerare."));
    } else if (kind === "location") {
      const sheet = locations[ref];
      if (!sheet?.references.some((r) => r.path === path)) run({ type: "location.upsert", ref, patch: { ...(sheet ? {} : { name: place?.name ?? ref }), references: [...(sheet?.references ?? []), entry] } });
      setNote(t("Tenuta come immagine di «{0}»: le vignette ambientate lì risultano da rigenerare, ora hanno il posto da guardare.", place?.name ?? ref));
    } else {
      const references = characters[ref]?.references ?? [];
      if (!references.some((r) => r.path === path)) run({ type: "character.upsert", ref, patch: { references: [...references, entry] } });
      setNote(t("Tenuta come riferimento di {0}. Le vignette in cui compare risultano da rigenerare: ora hanno un riferimento in più.", characters[ref]?.name || ref));
    }
  }

  // Cosa riceve il modello, per tipo: la coerenza dipende da questo più che dal prompt.
  const attached = item?.spec.references ?? [];
  const byKind = (kind: ReferenceKind) => attached.filter((r) => r.kind === kind);
  const counts = new Map<string, number>();
  for (const reference of byKind("character")) counts.set(reference.ref, (counts.get(reference.ref) ?? 0) + 1);
  const without = panel.characters.map((c) => c.ref).filter((ref) => !counts.has(ref));
  const attachedText = [
    byKind("style").length > 0 ? t("{0} {1} di stile", byKind("style").length, byKind("style").length === 1 ? "tavola" : "tavole") : null,
    byKind("location").length > 0 ? t("{0} del luogo", byKind("location").length) : null,
    ...[...counts].map(([ref, n]) => `${characters[ref]?.name || ref} ×${n}`),
  ].filter(Boolean);
  const presetLabel = t(STYLE_PRESETS.find((p) => p.id === project.style.preset)?.label ?? STYLE_PRESETS[0]!.label);

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>{t("genera l'arte")}</span>
        <span className="muted">
          {config.service === "mock"
            ? t("servizio di prova")
            : config.service === "azure"
              ? `${MODEL_LABEL[specModel(config)]} · Azure`
              : config.service === "local"
                ? t("{0} · locale", MODEL_LABEL[FLUX2_KLEIN_4B])
                : specModel(config)}
        </span>
      </p>

      <div className="stack">
        {!item ? (
          <p className="field__hint">{t("Si genera sul formato principale (")}{primaryLabel}{t("): le proporzioni della vignetta vengono da lì, e gli altri formati riusano la stessa immagine.")}</p>
        ) : (
          <>
            <p className="field__hint">
              {t("Questa vignetta:")}{" "}<strong>{t(STATE_LABEL[state])}</strong> · {item.spec.width}×{item.spec.height} px · seed {item.spec.seed}
            </p>
            {panel.art.source && <p className="issue issue--info">{t("Ha arte tua collegata, e quella vince: il render si vedrà solo scollegandola.")}</p>}
            <p className="field__hint">{t("Immagini allegate:")}{" "}{attachedText.length === 0 ? t("nessuna") : attachedText.join(" · ")}.</p>
            {/* Ciò che manca perché il capitolo non sembri un collage, nell'ordine in cui pesa: stile, luogo, personaggi. */}
            <ul className="readiness">
              {!styleChosen(project.style) && (
                <li className="issue issue--warning">
                  {t("Nessuno stile scelto per l'opera: si usa «")}{presetLabel}».{" "}
                  <button type="button" className="link-btn" onClick={() => onReferences("stile")}>
                    {t("scegli lo stile")}</button>
                </li>
              )}
              {byKind("style").length === 0 && (
                <li className="issue issue--info">
                  {t("Nessuna tavola di stile: il segno può variare da una vignetta all'altra. Quando una vignetta ti convince, tienila come tavola di stile qui sotto.")}</li>
              )}
              {place && !place.sheet?.description.trim() && (
                <li className="issue issue--warning">
                  «{place.name}{t("» non ha una descrizione: il modello riceve solo il nome e reinventa il posto a ogni vignetta.")}{" "}
                  <button type="button" className="link-btn" onClick={() => onReferences("luoghi", place.ref)}>
                    {t("descrivilo")}</button>
                </li>
              )}
              {place && place.sheet?.description.trim() && byKind("location").length === 0 && (
                <li className="issue issue--info">
                  «{place.name}{t("» non ha immagini: con una tavola del luogo la stanza resta la stessa stanza.")}{" "}
                  <button type="button" className="link-btn" onClick={() => onReferences("luoghi", place.ref)}>
                    {t("genera la tavola")}</button>
                </li>
              )}
              {without.length > 0 && (
                <li className="issue issue--info">
                  {t("Senza immagini (")}{without.map((ref) => characters[ref]?.name || ref).join(", ")}{t(") il modello ha solo la descrizione, e il personaggio cambia da una vignetta all'altra.")}{" "}
                  <button type="button" className="link-btn" onClick={() => onReferences("personaggi", without[0])}>
                    {t("genera la scheda")}</button>
                </li>
              )}
            </ul>

            <div className="tool-row">
              <button type="button" className="btn btn--small btn--primary" disabled={busy || !ready} onClick={() => void generate([item])}>
                {state === "none" ? t("Genera la vignetta") : "Rigenera"} · ~{usd(estimate([item]).usd)}
              </button>
              {record && (
                <button type="button" className="btn btn--small" disabled={busy || !ready} onClick={variant} title={t("Stessa vignetta con un altro seed; quella di prima resta in renders/")}>
                  {t("Altra variante")}</button>
              )}
              {pending.length > 0 && (
                <button type="button" className="btn btn--small" disabled={busy || !ready} onClick={() => void generate(pending)} title={t("Le vignette della pagina senza arte tua e senza un render aggiornato")}>
                  {t("Pagina:")}{" "}{pending.length} {" "}{t("da generare · ~")}{usd(estimate(pending).usd)}, ~{estimate(pending).seconds} s
                </button>
              )}
              {busy && (
                <button type="button" className="link-btn" onClick={generation.cancel}>
                  {t("ferma")}</button>
              )}
            </div>
            {generation.phase === "queued" && <p className="field__hint" role="status">{t("Immagini in coda")}</p>}
            {!ready && (
              <p className="field__hint">
                {config.service === "azure"
                  ? t("Servono endpoint e chiave della risorsa Azure AI Foundry")
                  : config.service === "local"
                    ? config.localManaged
                      ? t("Il modello locale delle immagini non è ancora installato (Progetto → Modelli locali…)")
                      : t("Serve l'indirizzo del motore locale, su questa macchina (http://127.0.0.1:porta)")
                    : t("Serve la chiave API di Black Forest Labs")}
                {t(": qui sotto, in «servizio e spesa».")}</p>
            )}
          </>
        )}

        {progress && (
          <p className="muted">
            {t("Genero…")}{" "}{progress.done}/{progress.total}
          </p>
        )}
        {report && (
          <p className={`issue issue--${report.failed.length > 0 ? "warning" : "info"}`}>
            {t("Pagina")}{" "}{reportPage} · {" "}
            {[
              report.done > 0 ? t("{0} generate", report.done) : null,
              report.cached > 0 ? t("{0} ritrovate in renders/ senza spesa", report.cached) : null,
              report.cancelled > 0 ? t("{0} fermate", report.cancelled) : null,
              report.failed.length > 0 ? t("{0} fallite", report.failed.length) : null,
            ]
              .filter(Boolean)
              .join(" · ") || t("Niente da generare")}
            {report.costUsd > 0 && t(" · addebitati {0}", usd(report.costUsd))}
          </p>
        )}
        {report?.failed.map((f) => (
          <p key={f.panelId} className="issue issue--error">
            <code>{f.panelId}</code>: {f.error}
          </p>
        ))}
        {error && <p className="issue issue--error">{error}</p>}

        {record && !panel.art.source && (
          <div className="tool-row">
            <span className="field__label">{t("è venuto bene? tienilo come")}</span>
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => void keep("style", "style")} title={t("Si allegherà a ogni generazione dell'opera: il modello ne copia il segno, non il contenuto")}>
              {t("tavola di stile")}</button>
            {place && (
              <button type="button" className="btn btn--small" disabled={busy} onClick={() => void keep("location", place.ref)} title={t("Si allegherà alle vignette ambientate lì")}>
                {t("immagine di «")}{place.name}»
              </button>
            )}
            {panel.characters.map((c) => (
              <button key={c.ref} type="button" className="btn btn--small" disabled={busy} onClick={() => void keep("character", c.ref)} title={t("Si allegherà alle vignette in cui compare")}>
                {characters[c.ref]?.name || c.ref}
              </button>
            ))}
          </div>
        )}
        {note && <p className="field__hint">{note}</p>}

        <details className="prompt-settings">
          <summary>{t("servizio e spesa")}</summary>
          <label className="field">
            <span className="field__label">{t("servizio")}</span>
            <select value={config.service} onChange={(e) => config.onService(e.target.value as ImageConfig["service"])}>
              <option value="azure">FLUX.2 — Azure AI Foundry</option>
              <option value="flux">FLUX.2 — Black Forest Labs</option>
              <option value="local">{t("FLUX.2 [klein] 4B — in locale, sulla tua GPU")}</option>
              <option value="mock">{t("prova, senza rete né spesa (immagine grigia)")}</option>
            </select>
          </label>
          {config.service === "azure" && (
            <>
              <label className="field">
                <span className="field__label">{t("endpoint della risorsa")}</span>
                <input type="text" value={config.azureEndpoint} onChange={(e) => config.onAzureEndpoint(e.target.value)} placeholder="https://nome.services.ai.azure.com" />
                <span className="field__hint">{t("Va bene anche l'endpoint del progetto (…/api/projects/nome): se ne usa l'indirizzo della risorsa.")}</span>
              </label>
              <label className="field">
                <span className="field__label">{t("chiave API")}</span>
                <input type="password" value={config.azureKey} onChange={(e) => config.onAzureKey(e.target.value)} placeholder={t("chiave della risorsa")} />
                <span className="field__hint">
                  {config.azureKeyFromEnv ? t("Letta da .env.local (solo in sviluppo). ") : keyNote}
                  <strong>{t("Prompt e riferimenti escono verso terzi")}</strong>{t(", e ogni immagine si paga.")}</span>
              </label>
              <label className="field">
                <span className="field__label">{t("modello")}</span>
                <select value={specModel(config)} onChange={(e) => config.onAzureDeployment(e.target.value === FLUX2_FLEX ? AZURE_FLUX_FLEX_DEPLOYMENT : AZURE_FLUX_DEPLOYMENT)}>
                  <option value={FLUX2_PRO}>{MODEL_LABEL[FLUX2_PRO]}</option>
                  <option value={FLUX2_FLEX}>{MODEL_LABEL[FLUX2_FLEX]}</option>
                </select>
                <span className="field__hint">{t("Cambiarlo rende «da rigenerare» le vignette fatte con l'altro; i loro file restano in renders/, e tornando indietro si ritrovano senza spesa.")}</span>
              </label>
              <label className="field">
                <span className="field__label">{t("nome del deployment")}</span>
                <input type="text" value={config.azureDeployment} onChange={(e) => config.onAzureDeployment(e.target.value)} placeholder={AZURE_FLUX_DEPLOYMENT} />
                <span className="field__hint">
                  {t("Il modello si riconosce da qui: [flex] se il nome contiene «flex», altrimenti [pro]. Il deployment ha un limite di richieste al minuto: una pagina intera può fermarsi ad aspettare, ed è normale.")}</span>
              </label>
            </>
          )}
          {config.service === "local" && <LocalEngineFields config={config} />}
          {config.service === "flux" && (
            <>
              <label className="field">
                <span className="field__label">{t("chiave API")}</span>
                <input type="password" value={config.apiKey} onChange={(e) => config.onApiKey(e.target.value)} placeholder={t("chiave di api.bfl.ai")} />
                <span className="field__hint">
                  {config.keyFromEnv ? t("Letta da .env.local (solo in sviluppo). ") : keyNote}
                  <strong>{t("Prompt e riferimenti escono verso terzi")}</strong>{t(", e ogni immagine si paga.")}</span>
              </label>
              <label className="field">
                <span className="field__label">{t("modello")}</span>
                <input type="text" value={config.model} onChange={(e) => config.onModel(e.target.value)} placeholder="flux-2-pro" />
              </label>
            </>
          )}
          <label className="field field--inline">
            <span className="field__label">{t("risoluzione")}</span>
            <select value={config.megapixels} onChange={(e) => config.onMegapixels(Number(e.target.value))}>
              <option value={1}>{t("1 megapixel")}</option>
              <option value={2}>{t("2 megapixel (costa di più)")}</option>
            </select>
          </label>
          <label className="field field--inline">
            <span className="field__label">{t("tetto di spesa per lancio ($)")}</span>
            <input type="number" min={0} step={0.5} value={cap} onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <p className="field__hint">{t("La spesa mostrata è una stima sul listino noto; quella vera la dichiara il fornitore a immagine fatta.")}</p>
        </details>
      </div>
    </div>
  );
}

/**
 * Il motore locale: dove ascolta, e una verifica di cosa ha caricato. Finché
 * non c'è l'app desktop (§14.4) sd-server si avvia a mano; poi lo avvierà lei.
 */
function LocalEngineFields({ config }: { config: ImageConfig }) {
  const [status, setStatus] = useState<{ level: "info" | "error"; text: string } | null>(null);
  const generation = useGeneration(config.localManaged ? local : config.localUrl);
  const checking = generation.phase !== null;

  async function check() {
    if (checking) return;
    setStatus(null);
    try {
      const info = await generation.schedule("local", "image", t("Verifica {0}", config.localModel ?? "motore immagini locale"), () => localService(config).check());
      const klein = /klein/i.test(info.model) && /4b/i.test(info.model);
      setStatus(
        klein
          ? { level: "info", text: t("Risponde, con {0} caricato.", info.model) }
          : { level: "error", text: t("Risponde, ma ha caricato «{0}»: lo spec registra FLUX.2 [klein] 4B, e i render direbbero il falso. Avvialo con klein 4B.", info.model) },
      );
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setStatus({ level: "error", text: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return (
    <>
      {config.localManaged ? (
        // Nell'app desktop il motore lo installa la procedura guidata e lo avvia l'app: niente indirizzo da scrivere.
        <p className="field__hint">
          {config.localModel ? (
            <>
              <strong>{config.localModel}</strong>{t(", sul tuo computer con stable-diffusion.cpp: parte da solo alla prima vignetta, e niente esce dal computer.")}{" "}
            </>
          ) : (
            <>{t("Il modello delle immagini non è ancora installato.")}{" "}</>
          )}
          <button type="button" className="link-btn" onClick={() => openLocalModels("image")}>
            {config.localModel ? t("modelli locali…") : t("Configura i modelli locali")}
          </button>
        </p>
      ) : (
        <label className="field">
          <span className="field__label">{t("indirizzo del motore")}</span>
          <input type="text" value={config.localUrl} onChange={(e) => config.onLocalUrl(e.target.value)} placeholder="http://127.0.0.1:1234" />
          <span className="field__hint">
            {t("sd-server di stable-diffusion.cpp, avviato su questa macchina con FLUX.2 [klein] 4B, il suo text encoder (Qwen3 4B) e il VAE di FLUX.2. Niente si paga e niente esce dal computer; serve una GPU con 8–13 GB di memoria, o un Mac con Apple Silicon. Nell'app desktop lo installa e lo avvia la procedura guidata.")}</span>
        </label>
      )}
      <div className="tool-row">
        <button type="button" className="btn btn--small" disabled={checking || (config.localManaged && !config.localModel)} onClick={() => void check()}>
          {generation.phase === "queued" ? t("Verifica in coda…") : checking ? "Verifico…" : t("Verifica il motore")}
        </button>
      </div>
      {status && <p className={`issue issue--${status.level}`}>{status.text}</p>}
      <p className="field__hint">
        {t("Quattro immagini di riferimento al massimo per vignetta (una di stile, una del luogo, il resto ai personaggi). Il modello è molto più piccolo di [pro]: buono per provare inquadrature e pagine, da confrontare con [pro] prima di fidarsene.")}</p>
    </>
  );
}
