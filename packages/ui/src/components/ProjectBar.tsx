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

export function ProjectBar({ editor, chapterLabel }: { editor: ProjectEditor; chapterLabel: string }) {
  const { status, folder } = editor;
  const tone = status.kind === "error" || status.kind === "locked-out" ? "bar__status--error" : status.kind === "memory" ? "bar__status--warn" : "";

  return (
    <header className="bar">
      <div className="bar__project">
        <span className="bar__title">
          <input
            className="bar__name"
            value={editor.doc.project.title}
            aria-label="Nome del progetto"
            title="Clicca per rinominare il progetto"
            size={Math.max(8, editor.doc.project.title.length)}
            onChange={(e) => editor.run({ type: "project.rename", title: e.target.value }, { gesture: "project-rename" })}
            onBlur={(e) => {
              if (!e.target.value.trim()) editor.run({ type: "project.rename", title: "Senza titolo" }, { gesture: "project-rename" });
              editor.endGesture();
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span className="bar__chapter">— {chapterLabel}</span>
        </span>
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
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            const unsaved = !folder && editor.canUndo;
            const title = window.prompt(
              unsaved
                ? "Nome del nuovo progetto?\n\nAttenzione: il progetto aperto non è salvato in una cartella e andrà perso."
                : "Nome del nuovo progetto?",
              "",
            );
            if (title !== null) void editor.newProject(title);
          }}
        >
          Nuovo progetto…
        </button>
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
