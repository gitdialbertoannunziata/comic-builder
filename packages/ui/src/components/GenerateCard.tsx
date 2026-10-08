import { useRef, useState } from "react";
import { panelSeed, renderState, type CharacterSheet, type Command, type Panel, type Project, type ProjectStore } from "@comic-builder/core";
import { AzureFluxImageService, estimateQueue, FluxImageService, MockImageService, type ImageService } from "@comic-builder/image";
import { generatePanels, promoteRender, type GenerationItem, type GenerationReport } from "../editor/generateArt.js";
import { usePreference } from "../usePreference.js";

/** Come si genera: scelto una volta per la sessione, vale per tutti i capitoli. */
export interface ImageConfig {
  service: "azure" | "flux" | "mock";
  onService: (service: ImageConfig["service"]) => void;
  apiKey: string;
  onApiKey: (key: string) => void;
  keyFromEnv: boolean;
  model: string;
  onModel: (model: string) => void;
  baseUrl: string;
  /** FLUX.2 [pro] distribuito su Azure AI Foundry: endpoint della risorsa, sua chiave, nome del deployment. */
  azureKey: string;
  onAzureKey: (key: string) => void;
  azureKeyFromEnv: boolean;
  azureEndpoint: string;
  onAzureEndpoint: (endpoint: string) => void;
  azureDeployment: string;
  onAzureDeployment: (deployment: string) => void;
  megapixels: number;
  onMegapixels: (megapixels: number) => void;
}

/**
 * Il modello che finisce nello spec: col servizio finto non si registra un
 * render come se fosse di FLUX. Su Azure è il modello, non il nome del
 * deployment: lo stesso spec vale da qualunque fornitore arrivi l'immagine.
 */
export function specModel(config: ImageConfig): string {
  if (config.service === "mock") return "mock-image";
  return config.service === "azure" ? "flux-2-pro" : config.model.trim() || "flux-2-pro";
}

// Nessuno dei due fornitori abilita CORS: si passa dal server di sviluppo (vite.config.ts).
const viaProxy = (url: string) => `/image-proxy/${url.replace(/^https:\/\//, "")}`;

export function makeService(config: ImageConfig): ImageService {
  if (config.service === "mock") return new MockImageService();
  if (config.service === "azure") {
    return new AzureFluxImageService({ apiKey: config.azureKey, endpoint: config.azureEndpoint, deployment: config.azureDeployment, rewriteUrl: viaProxy });
  }
  return new FluxImageService({
    apiKey: config.apiKey,
    model: specModel(config),
    baseUrl: config.baseUrl,
    rewriteUrl: viaProxy,
  });
}

/** Se c'è quanto serve per chiamare il servizio scelto. */
export function serviceReady(config: ImageConfig): boolean {
  if (config.service === "mock") return true;
  return config.service === "azure" ? config.azureKey.trim().length > 0 && config.azureEndpoint.trim().length > 0 : config.apiKey.trim().length > 0;
}

interface Props {
  config: ImageConfig;
  store: ProjectStore;
  project: Project;
  characters: Readonly<Record<string, CharacterSheet>>;
  pageId: string;
  panel: Panel;
  /** I pannelli della pagina coi loro spec; null se il formato mostrato non è quello su cui si genera. */
  items: readonly GenerationItem[] | null;
  /** Etichetta del formato principale, per dire dove andare quando `items` è null. */
  primaryLabel: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
}

const usd = (value: number) => `${value.toFixed(2).replace(".", ",")} $`;
const STATE_LABEL = { none: "mai generata", fresh: "aggiornata", stale: "da rigenerare: la vignetta è cambiata dopo il render" } as const;

/**
 * Arte generata (F3) con FLUX.2 [pro]. Lo spec viene dal documento (§9.1):
 * qui si vede cosa partirà — riferimenti, spesa — e si decide quando. La
 * coerenza dei personaggi (F5) sta nei riferimenti delle schede: un render
 * riuscito si può tenere come riferimento, ed è così che la scheda cresce.
 */
export function GenerateCard({ config, store, project, characters, pageId, panel, items, primaryLabel, run, endGesture }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<GenerationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = usePreference("imageCapUsd", 2);
  const abort = useRef<AbortController | null>(null);

  const item = items?.find((i) => i.panel.id === panel.id) ?? null;
  const state = item ? renderState(panel, item.spec) : "none";
  const pending = (items ?? []).filter((i) => !i.panel.art.source && renderState(i.panel, i.spec) !== "fresh");
  const record = item ? panel.render[item.spec.target] : null;
  const ready = serviceReady(config);

  // La stima non ha bisogno della chiave: si vede quanto costa prima di metterla.
  const estimator: ImageService = config.service === "mock" ? new MockImageService() : new FluxImageService({ apiKey: config.apiKey.trim() || "-", model: specModel(config) });
  const estimate = (list: readonly GenerationItem[]) => estimateQueue(estimator, list.map((i) => i.spec));

  async function generate(list: readonly GenerationItem[]) {
    if (list.length === 0) return;
    setError(null);
    setReport(null);
    setNote(null);
    const expected = estimate(list);
    if (expected.usd > cap) {
      setError(`La stima (${usd(expected.usd)}) supera il tetto di spesa (${usd(cap)}): alzalo qui sotto, o genera meno vignette.`);
      return;
    }
    let service: ImageService;
    try {
      service = makeService(config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setProgress({ done: 0, total: list.length });
    try {
      setReport(await generatePanels({ store, service, items: list, run, endGesture, signal: controller.signal, onProgress: setProgress }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setProgress(null);
      abort.current = null;
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

  async function keep(character: string) {
    if (!record) return;
    const path = await promoteRender(store, record.file, character);
    if (!path) return setNote("Il file del render non c'è più: rigenera la vignetta.");
    const references = characters[character]?.references ?? [];
    if (!references.some((r) => r.path === path)) {
      run({ type: "character.upsert", ref: character, patch: { references: [...references, { path, note: `da ${panel.id}`, use: true }] } });
    }
    setNote(`Tenuta come riferimento di ${character}. Le vignette in cui compare risultano da rigenerare: è voluto, ora hanno un riferimento in più.`);
  }

  const counts = new Map<string, number>();
  for (const reference of item?.spec.references ?? []) counts.set(reference.character, (counts.get(reference.character) ?? 0) + 1);
  const without = panel.characters.map((c) => c.ref).filter((ref) => !counts.has(ref));

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>genera l'arte</span>
        <span className="muted">{config.service === "mock" ? "servizio di prova" : config.service === "azure" ? "FLUX.2 [pro] · Azure" : specModel(config)}</span>
      </p>

      <div className="stack">
        {!item ? (
          <p className="field__hint">Si genera sul formato principale ({primaryLabel}): le proporzioni della vignetta vengono da lì, e gli altri formati riusano la stessa immagine.</p>
        ) : (
          <>
            <p className="field__hint">
              Questa vignetta: <strong>{STATE_LABEL[state]}</strong> · {item.spec.width}×{item.spec.height} px · seed {item.spec.seed}
            </p>
            {panel.art.source && <p className="issue issue--info">Ha arte tua collegata, e quella vince: il render si vedrà solo scollegandola.</p>}
            {panel.characters.length > 0 && (
              <p className="field__hint">
                Riferimenti allegati: {counts.size === 0 ? "nessuno" : [...counts].map(([ref, n]) => `${ref} ×${n}`).join(", ")}.
                {without.length > 0 && <> Senza riferimenti ({without.join(", ")}) il modello ha solo la descrizione, e il personaggio cambia da una vignetta all'altra: aggiungili nell'area Personaggi.</>}
              </p>
            )}

            <div className="tool-row">
              <button type="button" className="btn btn--small btn--primary" disabled={busy || !ready} onClick={() => void generate([item])}>
                {state === "none" ? "Genera la vignetta" : "Rigenera"} · ~{usd(estimate([item]).usd)}
              </button>
              {record && (
                <button type="button" className="btn btn--small" disabled={busy || !ready} onClick={variant} title="Stessa vignetta con un altro seed; quella di prima resta in renders/">
                  Altra variante
                </button>
              )}
              {pending.length > 0 && (
                <button type="button" className="btn btn--small" disabled={busy || !ready} onClick={() => void generate(pending)} title="Le vignette della pagina senza arte tua e senza un render aggiornato">
                  Pagina: {pending.length} da generare · ~{usd(estimate(pending).usd)}, ~{estimate(pending).seconds} s
                </button>
              )}
              {busy && (
                <button type="button" className="link-btn" onClick={() => abort.current?.abort()}>
                  ferma
                </button>
              )}
            </div>
            {!ready && <p className="field__hint">{config.service === "azure" ? "Servono endpoint e chiave della risorsa Azure AI Foundry" : "Serve la chiave API di Black Forest Labs"}: qui sotto, in «servizio e spesa».</p>}
          </>
        )}

        {progress && (
          <p className="muted">
            Genero… {progress.done}/{progress.total}
          </p>
        )}
        {report && (
          <p className={`issue issue--${report.failed.length > 0 ? "warning" : "info"}`}>
            {[
              report.done > 0 ? `${report.done} generate` : null,
              report.cached > 0 ? `${report.cached} ritrovate in renders/ senza spesa` : null,
              report.cancelled > 0 ? `${report.cancelled} fermate` : null,
              report.failed.length > 0 ? `${report.failed.length} fallite` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Niente da generare"}
            {report.costUsd > 0 && ` · addebitati ${usd(report.costUsd)}`}
          </p>
        )}
        {report?.failed.map((f) => (
          <p key={f.panelId} className="issue issue--error">
            <code>{f.panelId}</code>: {f.error}
          </p>
        ))}
        {error && <p className="issue issue--error">{error}</p>}

        {record && !panel.art.source && panel.characters.length > 0 && (
          <div className="tool-row">
            <span className="field__label">è venuto bene? tienilo come riferimento di</span>
            {panel.characters.map((c) => (
              <button key={c.ref} type="button" className="btn btn--small" disabled={busy} onClick={() => void keep(c.ref)}>
                {characters[c.ref]?.name || c.ref}
              </button>
            ))}
          </div>
        )}
        {note && <p className="field__hint">{note}</p>}

        <details className="prompt-settings">
          <summary>servizio e spesa</summary>
          <label className="field">
            <span className="field__label">servizio</span>
            <select value={config.service} onChange={(e) => config.onService(e.target.value as ImageConfig["service"])}>
              <option value="azure">FLUX.2 [pro] — Azure AI Foundry</option>
              <option value="flux">FLUX.2 — Black Forest Labs</option>
              <option value="mock">prova, senza rete né spesa (immagine grigia)</option>
            </select>
          </label>
          {config.service === "azure" && (
            <>
              <label className="field">
                <span className="field__label">endpoint della risorsa</span>
                <input type="text" value={config.azureEndpoint} onChange={(e) => config.onAzureEndpoint(e.target.value)} placeholder="https://nome.services.ai.azure.com" />
                <span className="field__hint">Va bene anche l'endpoint del progetto (…/api/projects/nome): se ne usa l'indirizzo della risorsa.</span>
              </label>
              <label className="field">
                <span className="field__label">chiave API</span>
                <input type="password" value={config.azureKey} onChange={(e) => config.onAzureKey(e.target.value)} placeholder="chiave della risorsa" />
                <span className="field__hint">
                  {config.azureKeyFromEnv ? "Letta da .env.local (solo in sviluppo). " : "Resta in questa scheda e non viene salvata. "}
                  <strong>Prompt e riferimenti escono verso terzi</strong>, e ogni immagine si paga.
                </span>
              </label>
              <label className="field">
                <span className="field__label">nome del deployment</span>
                <input type="text" value={config.azureDeployment} onChange={(e) => config.onAzureDeployment(e.target.value)} placeholder="FLUX.2-pro" />
                <span className="field__hint">Il deployment ha un limite di richieste al minuto: una pagina intera può fermarsi ad aspettare, ed è normale.</span>
              </label>
            </>
          )}
          {config.service === "flux" && (
            <>
              <label className="field">
                <span className="field__label">chiave API</span>
                <input type="password" value={config.apiKey} onChange={(e) => config.onApiKey(e.target.value)} placeholder="chiave di api.bfl.ai" />
                <span className="field__hint">
                  {config.keyFromEnv ? "Letta da .env.local (solo in sviluppo). " : "Resta in questa scheda e non viene salvata. "}
                  <strong>Prompt e riferimenti escono verso terzi</strong>, e ogni immagine si paga.
                </span>
              </label>
              <label className="field">
                <span className="field__label">modello</span>
                <input type="text" value={config.model} onChange={(e) => config.onModel(e.target.value)} placeholder="flux-2-pro" />
              </label>
            </>
          )}
          <label className="field field--inline">
            <span className="field__label">risoluzione</span>
            <select value={config.megapixels} onChange={(e) => config.onMegapixels(Number(e.target.value))}>
              <option value={1}>1 megapixel</option>
              <option value={2}>2 megapixel (costa di più)</option>
            </select>
          </label>
          <label className="field field--inline">
            <span className="field__label">tetto di spesa per lancio ($)</span>
            <input type="number" min={0} step={0.5} value={cap} onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <p className="field__hint">La spesa mostrata è una stima sul listino noto; quella vera la dichiara il fornitore a immagine fatta.</p>
        </details>
      </div>
    </div>
  );
}
