import { useRef, useState } from "react";
import { artPathFor, extensionOf, isArtFile, type Command, type Panel, type ProjectStore } from "@comic-builder/core";

interface Props {
  pageId: string;
  panel: Panel;
  store: ProjectStore | null;
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
 * L'arte del pannello. Due modi di collegarla, e il primo è quello di tutti
 * i giorni: esportare dal proprio programma in `art/` col nome del pannello,
 * e la pagina si aggiorna da sola. Il secondo, qui, copia un file qualsiasi
 * in `art/` con il nome giusto.
 */
export function ArtCard({ pageId, panel, store, url, run, scan }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function importFile(file: File) {
    setError(null);
    if (!store) return;
    if (!isArtFile(file.name)) {
      setError("Formati accettati: PNG, JPEG, WebP. Esporta da lì il file sorgente (PSD, CLIP, KRA).");
      return;
    }
    const path = artPathFor(panel.id, extensionOf(file.name));
    await store.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
    // Collegamento esplicito: vince su qualunque collegamento per nome precedente.
    run({
      type: "panel.update",
      pageId,
      panelId: panel.id,
      patch: { art: { source: path, status: panel.art.status === "missing" ? "sketch" : panel.art.status, sha: null } },
    });
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

      {!store ? (
        <p className="field__hint">
          L'arte vive nella cartella <code>art/</code> del progetto: salva prima il progetto in una cartella.
        </p>
      ) : (
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
              Esporta il disegno in <code>art/{panel.id}.png</code> (o .jpg, .webp): si collega da solo.
            </p>
          )}

          <div className="tool-row">
            <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
              {panel.art.source ? "Sostituisci…" : "Collega arte…"}
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
      )}
    </div>
  );
}
