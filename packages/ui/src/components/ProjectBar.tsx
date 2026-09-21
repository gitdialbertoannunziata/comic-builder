import type { ProjectEditor, SaveStatus } from "../editor/useProjectEditor.js";

function statusText(status: SaveStatus, folder: string | null): string {
  switch (status.kind) {
    case "memory":
      return "Non salvato: il progetto vive solo in questa scheda.";
    case "pending":
      return "Modifiche in attesa di salvataggio…";
    case "saving":
      return "Salvo…";
    case "saved":
      return `Salvato in «${folder ?? "?"}» alle ${status.at.toLocaleTimeString()}.`;
    case "error":
      return `Salvataggio non riuscito: ${status.message}`;
    case "locked-out":
      return status.message;
  }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

export function ProjectBar({ editor, title }: { editor: ProjectEditor; title: string }) {
  const { status, folder } = editor;
  const tone = status.kind === "error" || status.kind === "locked-out" ? "bar__status--error" : status.kind === "memory" ? "bar__status--warn" : "";

  return (
    <header className="bar">
      <div className="bar__project">
        <strong>{title}</strong>
        <span className="bar__folder">{folder ? `cartella: ${folder}` : "nessuna cartella"}</span>
      </div>

      <div className="bar__actions">
        <button type="button" className="btn btn--small" onClick={editor.undo} disabled={!editor.canUndo} title={`${mod}Z`}>
          ↶ {editor.undoLabel ? `Annulla «${editor.undoLabel}»` : "Annulla"}
        </button>
        <button type="button" className="btn btn--small" onClick={editor.redo} disabled={!editor.canRedo} title={`${mod}Shift+Z`}>
          ↷ Ripeti
        </button>
      </div>

      <div className="bar__actions">
        {editor.reopenable && (
          <button type="button" className="btn btn--small btn--primary" onClick={() => void editor.reopen()} title="Il browser chiede di nuovo il permesso per la cartella">
            Riapri «{editor.reopenable}»
          </button>
        )}
        {editor.canOpenFolders ? (
          <>
            <button type="button" className="btn btn--small" onClick={() => void editor.openFolder()}>
              Apri progetto…
            </button>
            <button type="button" className="btn btn--small" onClick={() => void editor.saveToFolder()}>
              {folder ? "Salva in un'altra cartella…" : "Salva in una cartella…"}
            </button>
          </>
        ) : (
          <span className="bar__hint">
            Questo browser non apre cartelle: per salvare il progetto serve Chrome o Edge.
          </span>
        )}
      </div>

      <p className={`bar__status ${tone}`} role="status">
        {statusText(status, folder)}
        {editor.recoveredAt && !folder && (
          <>
            {" "}
            Ripristinato il lavoro di questa scheda ({editor.recoveredAt.toLocaleString()}).{" "}
            <button type="button" className="link-btn" onClick={() => void editor.startOver()}>
              ricomincia da capo
            </button>
          </>
        )}
      </p>

      {editor.notice && (
        <p className="bar__notice" role="alert">
          {editor.notice}
          <button type="button" className="bar__dismiss" onClick={editor.dismissNotice} aria-label="Chiudi">
            ×
          </button>
        </p>
      )}
    </header>
  );
}
