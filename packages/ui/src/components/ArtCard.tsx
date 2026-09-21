import { useRef, useState } from "react";
import type { Command, Panel, ProjectStore } from "@comic-builder/core";
import { importArt } from "../editor/importArt.js";

interface Props {
  pageId: string;
  panel: Panel;
  /** Dove vanno le immagini: la cartella del progetto, o la memoria della scheda finché non c'è. */
  store: ProjectStore;
  /** Vero se il progetto non è ancora in una cartella: le immagini stanno in memoria. */
  inMemory: boolean;
  url: string | undefined;
  run: (command: Command) => boolean;
  scan: () => Promise<void>;
}

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
export function ArtCard({ pageId, panel, store, inMemory, url, run, scan }: Props) {
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
          {error && <p className="issue issue--error">{error}</p>}
      </div>
    </div>
  );
}
