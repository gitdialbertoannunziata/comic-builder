import { useState } from "react";
import type { Command, Panel, PanelBrief } from "@comic-builder/core";

interface Props {
  brief: PanelBrief;
  pageBrief: string;
  panel: Panel;
  pageId: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Lo stile non si scrive più qui: è dell'opera, e sta in Riferimenti → Stile. */
  onStyle: () => void;
}

type Tab = "brief" | "prompt" | "params";

/** Copia negli appunti; dove l'API non c'è (http senza TLS), lo dice invece di fallire in silenzio. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le istruzioni per un modello di immagini esterno, compilate dalle scelte
 * dell'editor (§9.1). Servono a provare i modelli prima di collegarne uno:
 * si copia, si incolla, si confronta. Cambiare camera, azione o balloon
 * cambia il testo subito — il prompt è derivato, non scritto.
 */
export function PromptCard({ brief, pageBrief, panel, pageId, run, endGesture, onStyle }: Props) {
  const [tab, setTab] = useState<Tab>("brief");
  const [copied, setCopied] = useState<string | null>(null);

  async function copyText(label: string, text: string) {
    setCopied((await copy(text)) ? `${label} copiato` : "Il browser non consente di copiare qui: seleziona il testo e copia a mano.");
    setTimeout(() => setCopied(null), 2500);
  }

  const params = [
    `aspect: ${brief.aspect}`,
    `size: ${brief.width}×${brief.height} px`,
    `sdxl: ${brief.sdxl.width}×${brief.sdxl.height}`,
    `seed: ${brief.seed}`,
  ].join("\n");

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>istruzioni per un modello esterno</span>
        <span className="segmented">
          {(["brief", "prompt", "params"] as const).map((t) => (
            <button key={t} type="button" className="seg" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "brief" ? "brief" : t === "prompt" ? "prompt" : "parametri"}
            </button>
          ))}
        </span>
      </p>

      {tab === "brief" && (
        <>
          <p className="field__hint">Per modelli che seguono istruzioni (ChatGPT, Gemini, Claude con immagini).</p>
          <pre className="prompt-text">{brief.brief}</pre>
          <div className="tool-row">
            <button type="button" className="btn btn--small" onClick={() => void copyText("Brief del pannello", brief.brief)}>
              Copia il brief
            </button>
            <button type="button" className="btn btn--small" onClick={() => void copyText("Brief della pagina", pageBrief)}>
              Copia tutta la pagina
            </button>
          </div>
        </>
      )}

      {tab === "prompt" && (
        <>
          <p className="field__hint">Per modelli di sole immagini (Stable Diffusion, Flux, Midjourney).</p>
          <span className="field__label">positivo{brief.overridden ? " — scritto da te" : ""}</span>
          <pre className="prompt-text">{brief.positive}</pre>
          <span className="field__label">negativo</span>
          <pre className="prompt-text prompt-text--negative">{brief.negative}</pre>
          <div className="tool-row">
            <button type="button" className="btn btn--small" onClick={() => void copyText("Prompt", brief.positive)}>
              Copia il positivo
            </button>
            <button type="button" className="btn btn--small" onClick={() => void copyText("Negativo", brief.negative)}>
              Copia il negativo
            </button>
          </div>
        </>
      )}

      {tab === "params" && (
        <>
          <pre className="prompt-text">{params}</pre>
          <p className="field__hint">
            Il seed deriva dal seed di serie e dal pannello: stesso pannello, stesso seed. Le proporzioni vengono dal box del pannello nel formato mostrato.
          </p>
          <button type="button" className="btn btn--small" onClick={() => void copyText("Parametri", params)}>
            Copia i parametri
          </button>
        </>
      )}

      {copied && <p className="muted revisions__message">{copied}</p>}

      <details className="prompt-settings">
        <summary>prompt personale</summary>
        <p className="field__hint">
          Lo stile è dell'opera, non della vignetta:{" "}
          <button type="button" className="link-btn" onClick={onStyle}>
            Riferimenti → Stile
          </button>
          .
        </p>
        <label className="field">
          <span className="field__label">prompt tuo per questo pannello (sostituisce quello compilato)</span>
          <textarea
            rows={2}
            value={panel.prompt.override ?? ""}
            placeholder="vuoto: si usa il prompt compilato dalle scelte dell'editor"
            onChange={(e) =>
              run(
                { type: "panel.update", pageId, panelId: panel.id, patch: { prompt: { ...panel.prompt, override: e.target.value.trim() ? e.target.value : null } } },
                { gesture: `${panel.id}:prompt` },
              )
            }
            onBlur={endGesture}
          />
        </label>
      </details>
    </div>
  );
}
