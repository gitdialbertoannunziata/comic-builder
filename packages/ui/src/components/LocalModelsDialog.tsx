import { useGeneration } from "../useGeneration.js";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FLUX2_KLEIN_4B, type RenderSpec } from "@comic-builder/core";
import { LocalSdImageService } from "@comic-builder/image";
import { LlamaServerLlmService } from "@comic-builder/llm";
import { desktopFetch } from "../platform/desktop.js";
import { gb, local, refreshLocalModels, setLocalOverview, useLocalModels, type Backend, type EngineKind, type InstallProgress, type LocalOverview } from "../platform/localModels.js";
import { generationScheduler, scheduleGeneration } from "../generationScheduler.js";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Finita la prova: lo spoglio e/o le immagini passano ai modelli locali. */
  onUse: (use: { text: boolean; image: boolean }) => void;
}

type Step = "computer" | "choice" | "install" | "try";

const BACKEND_LABEL: Record<Backend, string> = {
  metal: "Metal — la GPU del Mac",
  vulkan: "Vulkan — la scheda grafica (NVIDIA, AMD, Intel)",
  cpu: "Solo il processore — funziona ovunque, ma lento",
};
const PLATFORM_LABEL: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
const VRAM_CHOICES = [4, 6, 8, 10, 12, 16, 24];

/**
 * La procedura guidata dei modelli locali. Spoglio e immagini sul computer
 * di chi disegna, con la stessa strategia: l'app scarica i motori ufficiali
 * (llama.cpp, stable-diffusion.cpp) e i modelli, ne verifica il checksum, e
 * li avvia da sé quando servono. Quattro passi: cosa c'è in questo computer,
 * cosa installare, il download, una prova vera.
 */
export function LocalModelsDialog({ open, onClose, onUse }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const overview = useLocalModels();
  const [step, setStep] = useState<Step>("computer");

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      void refreshLocalModels();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="local-models" aria-label="Modelli locali" onClose={onClose}>
      <div className="local-models__body">
        <p className="local-models__title">
          <span>Modelli locali</span>
          <button type="button" className="link-btn" onClick={onClose}>
            chiudi
          </button>
        </p>
        {!local ? (
          <p className="field__hint">I modelli locali si installano dall'app desktop: nel browser lo spoglio locale passa da Ollama, e le immagini da un motore avviato a mano.</p>
        ) : !overview ? (
          <p className="muted">Guardo cosa c'è in questo computer…</p>
        ) : (
          open && <Wizard overview={overview} step={step} onStep={setStep} onUse={onUse} onClose={onClose} />
        )}
      </div>
    </dialog>
  );
}

function Wizard({ overview, step, onStep, onUse, onClose }: { overview: LocalOverview; step: Step; onStep: (step: Step) => void; onUse: Props["onUse"]; onClose: () => void }) {
  const { hardware, recommendation } = overview;
  const [backend, setBackend] = useState<Backend>(overview.state.backend ?? recommendation.backend);
  // Su Vulkan la memoria della GPU spesso non si legge: allora la dice l'autore.
  const [vram, setVram] = useState<number>(overview.state.memoryGB ?? overview.memory.vulkan);
  const memoryGB = backend === "vulkan" && !hardware.gpu?.vramGB ? vram : overview.memory[backend];
  const [text, setText] = useState<string | null>(overview.state.models.text ?? recommendation.text);
  const [image, setImage] = useState<string | null>(overview.state.models.image ?? recommendation.image);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installed = Boolean(overview.state.models.text || overview.state.models.image);
  const jobs = useSyncExternalStore(generationScheduler.subscribe, generationScheduler.getSnapshot, generationScheduler.getSnapshot);
  const localBusy = jobs.some((job) => job.lane === "local");

  const size = useMemo(() => {
    let total = 0;
    for (const [kind, id] of [["text", text], ["image", image]] as const) {
      const model = overview.models.find((m) => m.id === id);
      if (!model) continue;
      total += model.size;
      const engine = overview.state.engines[kind];
      if (!engine || engine.backend !== backend) total += overview.engineSize[kind][backend] ?? 0;
    }
    return total;
  }, [overview, text, image, backend]);

  async function install() {
    if (generationScheduler.getSnapshot().some((job) => job.lane === "local")) return;
    setError(null);
    onStep("install");
    const off = local!.onProgress(setProgress);
    try {
      await scheduleGeneration("local", "text", "Installazione modelli locali", async () => {
        setLocalOverview(await local!.install({ backend, memoryGB, text, image }));
      });
      onStep("try");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(cause));
    } finally {
      off();
      setProgress(null);
    }
  }

  if (step === "computer") {
    return (
      <div className="stack">
        <p className="local-models__step">1 di 4 · questo computer</p>
        <dl className="local-models__facts">
          <dt>sistema</dt>
          <dd>
            {PLATFORM_LABEL[hardware.platform] ?? hardware.platform} {hardware.arch === "arm64" ? "(Apple Silicon / ARM)" : hardware.arch}
          </dd>
          <dt>memoria</dt>
          <dd>{hardware.ramGB} GB di RAM</dd>
          <dt>grafica</dt>
          <dd>{hardware.gpu ? `${hardware.gpu.name}${hardware.gpu.vramGB ? `, ${hardware.gpu.vramGB} GB` : ""}` : "nessuna GPU riconosciuta"}</dd>
          <dt>spazio libero</dt>
          <dd>{hardware.freeDiskGB !== null ? `${hardware.freeDiskGB} GB` : "non rilevato"}</dd>
        </dl>
        <fieldset className="local-models__choices">
          <legend>accelerazione</legend>
          {overview.backends.map((b) => (
            <label key={b} className="local-models__choice">
              <input type="radio" name="backend" checked={backend === b} onChange={() => setBackend(b)} />
              <span>
                <strong>{BACKEND_LABEL[b]}</strong>
                {b === recommendation.backend && <span className="local-models__badge">consigliata</span>}
                <span className="field__hint">circa {overview.memory[b]} GB per i modelli</span>
              </span>
            </label>
          ))}
        </fieldset>
        {backend === "vulkan" && !hardware.gpu?.vramGB && (
          <label className="field field--inline">
            <span className="field__label">memoria della scheda grafica</span>
            <select value={vram} onChange={(e) => setVram(Number(e.target.value))}>
              {VRAM_CHOICES.map((v) => (
                <option key={v} value={v}>
                  {v} GB
                </option>
              ))}
            </select>
            <span className="field__hint">Non si legge da qui: la trovi nelle informazioni della scheda (Gestione attività → Prestazioni → GPU, su Windows).</span>
          </label>
        )}
        <div className="tool-row">
          <button type="button" className="btn btn--small btn--primary" onClick={() => onStep("choice")}>
            Avanti
          </button>
          {installed && (
            <>
              <button type="button" className="btn btn--small" onClick={() => onStep("try")}>
                Prova quelli installati
              </button>
              <button
                type="button"
                className="link-btn"
                disabled={localBusy}
                onClick={async () => {
                  if (generationScheduler.getSnapshot().some((job) => job.lane === "local")) return;
                  if (window.confirm(`Togliere motori e modelli locali (${overview.folder})? Si riscaricano dalla procedura.`)) await scheduleGeneration("local", "text", "Rimozione modelli locali", async () => { setLocalOverview(await local!.remove()); });
                }}
              >
                togli i modelli locali
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (step === "choice") {
    const options = (kind: EngineKind) => overview.models.filter((m) => m.kind === kind);
    const blocked = overview.blocked[backend];
    const choice = (kind: EngineKind, value: string | null, set: (id: string | null) => void) => (
      <fieldset className="local-models__choices">
        <legend>{kind === "text" ? "spoglio del copione" : "immagini delle vignette"}</legend>
        {blocked[kind] ? (
          <p className="issue issue--warning">{blocked[kind]}</p>
        ) : (
          <>
            {options(kind).map((m) => {
              const tight = m.minMemoryGB > memoryGB;
              return (
                <label key={m.id} className="local-models__choice">
                  <input type="radio" name={kind} checked={value === m.id} onChange={() => set(m.id)} />
                  <span>
                    <strong>{m.label}</strong> <span className="muted">{gb(m.size)}</span>
                    {m.id === recommendation[kind] && backend === recommendation.backend && <span className="local-models__badge">consigliato</span>}
                    <span className="field__hint">
                      {m.hint}
                      {tight && ` — con ${memoryGB} GB è al limite: lento, o non parte.`}
                    </span>
                  </span>
                </label>
              );
            })}
            <label className="local-models__choice">
              <input type="radio" name={kind} checked={value === null} onChange={() => set(null)} />
              <span>
                <strong>non in locale</strong>
                <span className="field__hint">{kind === "text" ? "lo spoglio resta a un servizio cloud, o a Ollama" : "le immagini restano a FLUX.2 [pro] nel cloud"}</span>
              </span>
            </label>
          </>
        )}
      </fieldset>
    );
    const noDisk = hardware.freeDiskGB !== null && size / 1e9 > hardware.freeDiskGB - 1;
    return (
      <div className="stack">
        <p className="local-models__step">2 di 4 · cosa installare</p>
        {choice("text", blocked.text ? null : text, setText)}
        {choice("image", blocked.image ? null : image, setImage)}
        {recommendation.notes.length > 0 && backend === recommendation.backend && (
          <ul className="readiness">
            {recommendation.notes.map((n) => (
              <li key={n} className="issue issue--info">
                {n}
              </li>
            ))}
          </ul>
        )}
        <p className="field__hint">
          Da scaricare: <strong>{gb(size)}</strong>
          {hardware.freeDiskGB !== null && ` · liberi ${hardware.freeDiskGB} GB`}. Tutto va in <code>{overview.folder}</code>; i modelli sono Apache 2.0, e ogni file si verifica col suo checksum.
        </p>
        {noDisk && <p className="issue issue--error">Non c'è abbastanza spazio sul disco.</p>}
        <div className="tool-row">
          <button type="button" className="btn btn--small" onClick={() => onStep("computer")}>
            Indietro
          </button>
          <button type="button" className="btn btn--small btn--primary" disabled={(!text && !image) || noDisk || localBusy} onClick={() => void install()}>
            {size > 0 ? `Scarica e installa (${gb(size)})` : "Installa"}
          </button>
        </div>
        {localBusy && <p className="field__hint">Installazione disponibile quando la coda locale e' libera.</p>}
      </div>
    );
  }

  if (step === "install") {
    const share = progress && progress.total > 0 ? progress.received / progress.total : 0;
    return (
      <div className="stack">
        <p className="local-models__step">3 di 4 · scarico</p>
        {progress ? (
          <>
            <p>
              {progress.label} <span className="muted">· file {progress.step} di {progress.steps}</span>
            </p>
            <progress className="local-models__bar" value={share} max={1} />
            <p className="field__hint">
              {progress.total > 0 ? `${gb(progress.received)} di ${gb(progress.total)}` : "preparo…"} · se si interrompe, riprendendo si riparte da dove era arrivato.
            </p>
          </>
        ) : (
          !error && <p className="muted">Comincio…</p>
        )}
        {error && <p className="issue issue--error">{error}</p>}
        <div className="tool-row">
          {error ? (
            <>
              <button type="button" className="btn btn--small" onClick={() => onStep("choice")}>
                Indietro
              </button>
              <button type="button" className="btn btn--small btn--primary" onClick={() => void install()}>
                Riprendi
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--small" onClick={() => void local!.cancel()}>
              Interrompi
            </button>
          )}
        </div>
      </div>
    );
  }

  return <TryStep overview={overview} onBack={() => onStep("computer")} onUse={onUse} onClose={onClose} />;
}

/** La prova: si avvia ogni motore installato e gli si fa fare un lavoro piccolo, vero, misurando il tempo. */
function TryStep({ overview, onBack, onUse, onClose }: { overview: LocalOverview; onBack: () => void; onUse: Props["onUse"]; onClose: () => void }) {
  const has = { text: Boolean(overview.state.models.text), image: Boolean(overview.state.models.image) };
  const [results, setResults] = useState<Partial<Record<EngineKind, { ok: boolean; text: string; image?: string }>>>({});
  const [busy, setBusy] = useState<EngineKind | null>(null);
  const generation = useGeneration(local);

  async function tryText() {
    if (busy) return;
    setBusy("text");
    const started = Date.now();
    try {
      const llm = new LlamaServerLlmService({ resolveBaseUrl: () => local!.start("text"), fetchImpl: desktopFetch, maxTokens: 200 });
      const answer = await generation.schedule("local", "text", `Prova ${overview.models.find((model) => model.id === overview.state.models.text)?.label ?? "testo locale"}`, () => llm.complete({
        system: "Rispondi solo con JSON conforme allo schema.",
        user: "Scrivi una battuta di un fumetto, in italiano, di non più di dieci parole.",
        schema: { type: "object", properties: { battuta: { type: "string" } }, required: ["battuta"], additionalProperties: false },
        schemaName: "Prova",
      }));
      const line = (answer.data as { battuta?: string }).battuta ?? "";
      setResults((r) => ({ ...r, text: { ok: true, text: `«${line}» — ${Math.round((Date.now() - started) / 1000)} s, avvio del motore compreso.` } }));
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setResults((r) => ({ ...r, text: { ok: false, text: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      if (generation.isCurrent()) setBusy(null);
    }
  }

  async function tryImage() {
    if (busy) return;
    setBusy("image");
    const started = Date.now();
    try {
      const service = new LocalSdImageService({ resolveBaseUrl: () => local!.start("image"), fetchImpl: desktopFetch });
      const spec: RenderSpec = {
        panel: "prova",
        target: "prova",
        width: 512,
        height: 512,
        aspect: "1:1",
        prompt: "Wordless comic panel: a red apple on a wooden kitchen table, hand-drawn ink and flat colours.",
        seed: 42,
        model: FLUX2_KLEIN_4B,
        prompt_upsampling: false,
        output_format: "png",
        references: [],
        control_image: null,
        compiler: 2,
      };
      const result = await generation.schedule("local", "image", `Prova ${overview.models.find((model) => model.id === overview.state.models.image)?.label ?? "immagini locali"}`, () => service.generate({ spec, references: [] }));
      const url = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.mediaType }));
      setResults((r) => ({ ...r, image: { ok: true, text: `512×512 in ${Math.round((Date.now() - started) / 1000)} s, avvio del motore compreso. Una vignetta vera, con i riferimenti, chiede di più.`, image: url } }));
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setResults((r) => ({ ...r, image: { ok: false, text: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      if (generation.isCurrent()) setBusy(null);
    }
  }

  return (
    <div className="stack">
      <p className="local-models__step">4 di 4 · prova</p>
      {generation.phase === "queued" && <p className="field__hint" role="status">Prova in coda</p>}
      <p className="field__hint">Ogni motore parte quando serve e si ferma quando parte l'altro: spoglio e immagini vanno a turno, così non si contendono la memoria.</p>
      {has.text && (
        <div className="local-models__try">
          <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => void tryText()}>
            {busy === "text" ? "Avvio e provo lo spoglio…" : "Prova lo spoglio"}
          </button>
          {results.text && <p className={`issue issue--${results.text.ok ? "info" : "error"}`}>{results.text.text}</p>}
        </div>
      )}
      {has.image && (
        <div className="local-models__try">
          <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => void tryImage()}>
            {busy === "image" ? "Avvio e genero un'immagine…" : "Prova le immagini"}
          </button>
          {results.image && <p className={`issue issue--${results.image.ok ? "info" : "error"}`}>{results.image.text}</p>}
          {results.image?.image && <img className="local-models__sample" src={results.image.image} alt="Immagine di prova del motore locale" />}
        </div>
      )}
      {!has.text && !has.image && <p className="field__hint">Niente di installato da provare.</p>}
      <div className="tool-row">
        <button type="button" className="btn btn--small" onClick={onBack}>
          Indietro
        </button>
        <button
          type="button"
          className="btn btn--small btn--primary"
          disabled={!has.text && !has.image}
          onClick={() => {
            onUse(has);
            onClose();
          }}
        >
          Usa i modelli locali{has.text && has.image ? " per spoglio e immagini" : has.text ? " per lo spoglio" : " per le immagini"}
        </button>
      </div>
    </div>
  );
}
