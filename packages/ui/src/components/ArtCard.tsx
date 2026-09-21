import { useRef, useState } from "react";
import type { ArtFrame, Command, Panel, ProjectStore } from "@comic-builder/core";
import { importArt } from "../editor/importArt.js";

interface Props {
  pageId: string;
  panel: Panel;
  /** Dove vanno le immagini: la cartella del progetto, o la memoria della scheda finché non c'è. */
  store: ProjectStore;
  /** Vero se il progetto non è ancora in una cartella: le immagini stanno in memoria. */
  inMemory: boolean;
  url: string | undefined;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  scan: () => Promise<void>;
  /** Inquadratura col mouse sulla pagina: trascina per spostare, rotella per lo zoom. */
  framing: boolean;
  onToggleFraming: () => void;
}

export const DEFAULT_FRAME: ArtFrame = { fit: "cover", zoom: 1, focus_x: 0.5, focus_y: 0.5 };

const STATUSES = ["missing", "sketch", "inked", "colored", "final"] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  missing: "mancante",
  sketch: "schizzo",
  inked: "inchiostrato",
  colored: "colorato",
  final: "finito",
};

/**
 * L'arte del pannello. Tre modi di collegarla: caricarla da qui, trascinarla
 * sul pannello nella pagina, o esportarla dal proprio programma in `art/`
 * col nome del pannello (la pagina si aggiorna da sola). Funziona anche
 * prima di scegliere una cartella: l'immagine resta in memoria, e al
 * salvataggio viene copiata in `art/`.
 */
export function ArtCard({ pageId, panel, store, inMemory, url, run, endGesture, scan, framing, onToggleFraming }: Props) {
  const frame = { ...DEFAULT_FRAME, ...panel.art.frame };
  const setFrame = (patch: Partial<ArtFrame>, gesture?: string) =>
    run({ type: "panel.update", pageId, panelId: panel.id, patch: { art: { ...panel.art, frame: { ...frame, ...patch } } } }, gesture ? { gesture } : {});
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File) {
    setError(await importArt(store, run, pageId, panel, file));
    await scan();
  }

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>arte</span>
        {panel.art.source && (
          <button
            type="button"
            className="link-btn"
            onClick={() => run({ type: "panel.update", pageId, panelId: panel.id, patch: { art: { source: null, status: "missing", sha: null } } })}
            title="Il file resta in art/: si scollega solo dal pannello"
          >
            scollega
          </button>
        )}
      </p>

      <div className="stack">
          {panel.art.source ? (
            <div className="art-row">
              {url ? <img className="art-thumb" src={url} alt="" /> : <span className="art-thumb art-thumb--missing">?</span>}
              <span className="art-meta">
                <code>{panel.art.source}</code>
                {!url && <span className="issue issue--warning">file non trovato nella cartella</span>}
              </span>
            </div>
          ) : (
            <p className="field__hint">
              Carica un'immagine, oppure trascinala sul pannello nella pagina.
              {inMemory ? " Resta in questa scheda finché non salvi il progetto in una cartella." : <> Se la esporti tu in <code>art/{panel.id}.png</code>, si collega da sola.</>}
            </p>
          )}

          <div className="tool-row">
            <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
              {panel.art.source ? "Sostituisci l'immagine…" : "Carica immagine…"}
            </button>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <label className="field field--inline">
              <span className="field__label">stato</span>
              <select
                value={panel.art.status}
                onChange={(e) =>
                  run({ type: "panel.update", pageId, panelId: panel.id, patch: { art: { ...panel.art, status: e.target.value as Panel["art"]["status"] } } })
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {panel.art.source && url && (
            <div className="art-frame">
              <span className="field__label">inquadratura</span>
              {!panel.art.size ? (
                <p className="field__hint">Leggo le dimensioni dell'immagine…</p>
              ) : (
                <>
                  <div className="tool-row">
                    <span className="segmented">
                      <button type="button" className="seg" aria-pressed={frame.fit === "cover"} onClick={() => setFrame({ fit: "cover" })} title="L'immagine riempie il pannello: i bordi in più si tagliano">
                        riempie
                      </button>
                      <button type="button" className="seg" aria-pressed={frame.fit === "contain"} onClick={() => setFrame({ fit: "contain" })} title="L'immagine si vede intera: dove non arriva resta il fondo">
                        intera
                      </button>
                    </span>
                    <button type="button" className="btn btn--small" aria-pressed={framing} onClick={onToggleFraming}>
                      {framing ? "Fine inquadratura" : "Inquadra sulla pagina"}
                    </button>
                    <button type="button" className="link-btn" onClick={() => setFrame(DEFAULT_FRAME)}>
                      reimposta
                    </button>
                  </div>
                  <label className="field field--inline">
                    <span className="field__label">zoom</span>
                    <input
                      type="range"
                      min={0.5}
                      max={4}
                      step={0.01}
                      value={frame.zoom}
                      onChange={(e) => setFrame({ zoom: Number(e.target.value) }, `${panel.id}:art-zoom`)}
                      onPointerUp={endGesture}
                      onKeyUp={endGesture}
                    />
                    <span className="muted">{Math.round(frame.zoom * 100)}%</span>
                  </label>
                  {framing && <p className="field__hint">Sulla pagina: trascina dentro il pannello per spostare il disegno, rotella per ingrandire.</p>}
                </>
              )}
            </div>
          )}
          {error && <p className="issue issue--error">{error}</p>}
      </div>
    </div>
  );
}
