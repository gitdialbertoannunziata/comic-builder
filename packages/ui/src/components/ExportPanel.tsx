import type { ExportFormat } from "../exportPages.js";

interface Props {
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  widthPx: number;
  onWidthChange: (width: number) => void;
  scope: "page" | "chapter";
  onScopeChange: (scope: "page" | "chapter") => void;
  draft: boolean;
  onDraftChange: (draft: boolean) => void;
  destination: string | null;
  canChooseDestination: boolean;
  onChooseDestination: () => void;
  onExport: () => void;
  busy: boolean;
  result: string | null;
  error: string | null;
  pageCount: number;
}

export function ExportPanel({
  format,
  onFormatChange,
  widthPx,
  onWidthChange,
  scope,
  onScopeChange,
  draft,
  onDraftChange,
  destination,
  canChooseDestination,
  onChooseDestination,
  onExport,
  busy,
  result,
  error,
  pageCount,
}: Props) {
  return (
    <div className="stack">
      <div className="field">
        <span className="field__label">formato</span>
        <div className="segmented">
          {(["png", "svg", "json"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="seg"
              aria-pressed={format === f}
              onClick={() => onFormatChange(f)}
              title={
                f === "json"
                  ? "Il documento rieditabile: griglia, balloon, camera come dati"
                  : f === "svg"
                    ? "Vettoriale, col font incorporato"
                    : "Immagine finita"
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">cosa</span>
        <div className="segmented">
          <button
            type="button"
            className="seg"
            aria-pressed={scope === "page"}
            onClick={() => onScopeChange("page")}
          >
            pagina corrente
          </button>
          <button
            type="button"
            className="seg"
            aria-pressed={scope === "chapter"}
            onClick={() => onScopeChange("chapter")}
          >
            capitolo ({pageCount})
          </button>
        </div>
      </div>

      {format === "png" && (
        <label className="field">
          <span className="field__label">larghezza px</span>
          <input
            type="number"
            min={200}
            step={100}
            value={widthPx}
            onChange={(e) => onWidthChange(Number(e.target.value))}
          />
        </label>
      )}

      {format !== "json" && (
        <label className="field field--row">
          <input type="checkbox" checked={draft} onChange={(e) => onDraftChange(e.target.checked)} />
          <span>
            includi la specifica di disegno
            <span className="field__hint"> — spenta, un pannello senza arte resta vuoto</span>
          </span>
        </label>
      )}

      <div className="field">
        <span className="field__label">destinazione</span>
        {canChooseDestination ? (
          <>
            <button type="button" className="btn" onClick={onChooseDestination}>
              {destination ? `cartella: ${destination}` : "Scegli una cartella…"}
            </button>
            {!destination && (
              <span className="field__hint">Senza cartella scelta, i file finiscono nei download.</span>
            )}
          </>
        ) : (
          <span className="field__hint">
            Questo browser non consente di scegliere una cartella: i file finiscono dove li mette lui, nei
            download.
          </span>
        )}
      </div>

      <button type="button" className="btn btn--primary" onClick={onExport} disabled={busy}>
        {busy ? "Esporto…" : "Esporta"}
      </button>

      {error && <p className="issue issue--error script__result">{error}</p>}
      {result && !error && <p className="muted script__result">{result}</p>}
    </div>
  );
}
