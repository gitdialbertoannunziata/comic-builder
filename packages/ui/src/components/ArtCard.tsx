import { t } from "../i18n.js";
import { useEffect, useRef, useState } from "react";
import { shownArt, shownArtPatch, type ArtFrame, type Command, type ImageSize, type Panel, type ProjectStore } from "@comic-builder/core";
import { importArt } from "../editor/importArt.js";

interface Props {
  pageId: string;
  panel: Panel;
  /** Il target su cui si genera: il suo render è l'immagine del pannello quando non c'è arte dell'autore. */
  target: string;
  /** Dove vanno le immagini: la cartella del progetto, o la memoria della scheda finché non c'è. */
  store: ProjectStore;
  /** Vero se il progetto non è ancora in una cartella: le immagini stanno in memoria. */
  inMemory: boolean;
  url: string | undefined;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  scan: () => Promise<void>;
  /** Inquadratura sulla pagina: trascina o frecce per spostare, rotella o + − per lo zoom. */
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
export function ArtCard({ pageId, panel, target, store, inMemory, url, run, endGesture, scan, framing, onToggleFraming }: Props) {
  // L'immagine che il pannello mostra: l'arte dell'autore, o il render. Si inquadrano allo stesso modo.
  const shown = shownArt(panel, target);
  const frame = { ...DEFAULT_FRAME, ...shown?.frame };

  // Un render di prima che le dimensioni si registrassero non le ha: si leggono dall'immagine,
  // e vanno nel documento col primo ritocco dell'inquadratura.
  const [measured, setMeasured] = useState<ImageSize | null>(null);
  const needsSize = shown !== null && shown.size === null;
  useEffect(() => {
    setMeasured(null);
    if (!needsSize || !url) return;
    let alive = true;
    const img = new Image();
    img.onload = () => alive && img.naturalWidth > 0 && setMeasured({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    return () => {
      alive = false;
    };
  }, [needsSize, url, shown?.file]);
  const size = shown?.size ?? measured;

  const setFrame = (patch: Partial<ArtFrame>, gesture?: string) => {
    const change = shownArtPatch(panel, target, { ...frame, ...patch }, size);
    if (change) run({ type: "panel.update", pageId, panelId: panel.id, patch: change }, gesture ? { gesture } : {});
  };
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File) {
    setError(await importArt(store, run, pageId, panel, file));
    await scan();
  }

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>{t("arte")}</span>
        {panel.art.source && (
          <button
            type="button"
            className="link-btn"
            onClick={() => run({ type: "panel.update", pageId, panelId: panel.id, patch: { art: { source: null, status: "missing", sha: null } } })}
            title={t("Il file resta in art/: si scollega solo dal pannello")}
          >
            {t("scollega")}</button>
        )}
      </p>

      <div className="stack">
          {shown ? (
            <div className="art-row">
              {url ? <img className="art-thumb" src={url} alt="" /> : <span className="art-thumb art-thumb--missing">?</span>}
              <span className="art-meta">
                {shown.kind === "render" && <span className="field__label">{t("generata")}</span>}
                <code>{shown.file}</code>
                {!url && <span className="issue issue--warning">{t("file non trovato nella cartella")}</span>}
              </span>
            </div>
          ) : null}
          {!panel.art.source && (
            <p className="field__hint">
              {t("Carica un'immagine, oppure trascinala sul pannello nella pagina.")}{inMemory ? t(" Resta in questa scheda finché non salvi il progetto in una cartella.") : <> {" "}{t("Se la esporti tu in")}{" "}<code>art/{panel.id}.png</code>{t(", si collega da sola.")}</>}
              {shown?.kind === "render" && t(" La tua vince su quella generata.")}
            </p>
          )}

          <div className="tool-row">
            <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
              {panel.art.source ? t("Sostituisci l'immagine…") : t("Carica immagine…")}
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
              <span className="field__label">{t("stato")}</span>
              <select
                value={panel.art.status}
                onChange={(e) =>
                  run({ type: "panel.update", pageId, panelId: panel.id, patch: { art: { ...panel.art, status: e.target.value as Panel["art"]["status"] } } })
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_LABELS[s])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {shown && url && (
            <div className="art-frame">
              <span className="field__label">{t("inquadratura")}</span>
              {!size ? (
                <p className="field__hint">{t("Leggo le dimensioni dell'immagine…")}</p>
              ) : (
                <>
                  <div className="tool-row">
                    <span className="segmented">
                      <button type="button" className="seg" aria-pressed={frame.fit === "cover"} onClick={() => setFrame({ fit: "cover" })} title={t("L'immagine riempie il pannello: i bordi in più si tagliano")}>
                        {t("riempie")}</button>
                      <button type="button" className="seg" aria-pressed={frame.fit === "contain"} onClick={() => setFrame({ fit: "contain" })} title={t("L'immagine si vede intera: dove non arriva resta il fondo")}>
                        {t("intera")}</button>
                    </span>
                    <button
                      type="button"
                      className="btn btn--small"
                      aria-pressed={framing}
                      onClick={() => {
                        // Sulla pagina l'inquadratura si calcola dalle dimensioni: se non sono ancora nel documento, ci vanno adesso.
                        if (!framing && needsSize) setFrame({});
                        onToggleFraming();
                      }}
                      title={t("Sulla pagina: trascina o frecce per spostare, rotella o + − per ingrandire (I)")}
                    >
                      {framing ? t("Fine inquadratura") : t("Inquadra sulla pagina")}
                    </button>
                    <button type="button" className="link-btn" onClick={() => setFrame(DEFAULT_FRAME)}>
                      {t("reimposta")}</button>
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
                  {framing && <p className="field__hint">{t("Sulla pagina: trascina dentro il pannello (o frecce) per spostare l'immagine, rotella (o + −) per ingrandire, Esc per finire.")}</p>}
                  {shown.kind === "render" && <p className="field__hint">{t("L'inquadratura è di questa immagine: una rigenerata riparte centrata, e Ctrl+Z riporta quella di prima con la sua.")}</p>}
                </>
              )}
            </div>
          )}
          {error && <p className="issue issue--error">{error}</p>}
      </div>
    </div>
  );
}
