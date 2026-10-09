import { useRef } from "react";
import type { Chapter } from "@comic-builder/core";
import type { ProjectEditor, SaveStatus } from "../editor/useProjectEditor.js";
import type { Area } from "./Workspace.js";
import { Tabs } from "./Tabs.js";

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

/** Lo stato in due parole, per la pillola: il testo intero sta nel `title`. */
function statusShort(status: SaveStatus): string {
  switch (status.kind) {
    case "memory":
      return "non salvato";
    case "pending":
      return "da salvare…";
    case "saving":
      return "salvo…";
    case "saved":
      return `salvato ${status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    case "error":
      return "salvataggio fallito";
    case "locked-out":
      return "sola lettura";
  }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

interface Props {
  editor: ProjectEditor;
  chapters: readonly Chapter[];
  chapterId: string;
  onSelectChapter: (chapterId: string) => void;
  area: Area;
  onArea: (area: Area) => void;
  openRevisions: number;
  /** Apre la legenda delle scorciatoie. */
  onHelp: () => void;
}

/**
 * La barra: dove si è (opera, capitolo, area di lavoro) e se il lavoro è al
 * sicuro. Una riga; avvisi ed errori ne aggiungono una solo quando ci sono.
 */
export function ProjectBar({ editor, chapters, chapterId, onSelectChapter, area, onArea, openRevisions, onHelp }: Props) {
  const { status, folder } = editor;
  const tone = status.kind === "error" || status.kind === "locked-out" ? "error" : status.kind === "memory" ? "warn" : status.kind === "saved" ? "ok" : "busy";
  const menu = useRef<HTMLDetailsElement>(null);
  const ordered = [...chapters].sort((a, b) => a.number - b.number);

  function newProject() {
    const unsaved = !folder && editor.canUndo;
    const title = window.prompt(
      unsaved ? "Nome del nuovo progetto?\n\nAttenzione: il progetto aperto non è salvato in una cartella e andrà perso." : "Nome del nuovo progetto?",
      "",
    );
    if (title !== null) void editor.newProject(title);
  }

  return (
    <header className="bar">
      <div className="bar__row">
        <div className="bar__where">
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
          <select className="bar__chapter" value={chapterId} onChange={(e) => onSelectChapter(e.target.value)} aria-label="Capitolo aperto" title="Capitolo aperto">
            {ordered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}. {c.title || "senza titolo"}
              </option>
            ))}
          </select>
        </div>

        <Tabs<Area>
          label="Area di lavoro"
          className="tabs--areas"
          value={area}
          onChange={onArea}
          items={[
            { id: "copione", label: "Copione", title: "Capitoli, testo e spoglio" },
            { id: "pagine", label: "Pagine", title: "Pagine, vignette, balloon, arte" },
            { id: "personaggi", label: "Riferimenti", title: "Stile, personaggi e luoghi dell'opera: ciò che tiene uguali le vignette" },
            { id: "revisioni", label: "Revisioni", badge: openRevisions, title: "Correzioni dello sceneggiatore, trova e sostituisci" },
            { id: "export", label: "Export", title: "Il capitolo nei formati del progetto" },
          ]}
        />

        <div className="bar__tools">
          <button type="button" className="btn btn--small btn--icon" onClick={editor.undo} disabled={!editor.canUndo} title={`${editor.undoLabel ? `Annulla «${editor.undoLabel}»` : "Annulla"} (${mod}Z)`} aria-label="Annulla">
            ↶
          </button>
          <button type="button" className="btn btn--small btn--icon" onClick={editor.redo} disabled={!editor.canRedo} title={`Ripeti (${mod}Shift+Z)`} aria-label="Ripeti">
            ↷
          </button>
          <button
            type="button"
            className={`btn btn--small${status.kind === "memory" ? " btn--primary" : ""}`}
            onClick={() => void editor.save()}
            disabled={status.kind === "saved" || status.kind === "saving" || status.kind === "locked-out"}
            title={`${folder ? `Salva in «${folder}»` : "Salva il progetto in una cartella"} (${mod}S)`}
          >
            {folder ? "Salva" : "Salva…"}
          </button>
          <span className={`pill pill--${tone}`} role="status" title={statusText(status, folder)}>
            {statusShort(status)}
          </span>
          {editor.reopenable && (
            <button type="button" className="btn btn--small btn--primary" onClick={() => void editor.reopen()} title="Il browser chiede di nuovo il permesso per la cartella">
              Riapri «{editor.reopenable}»
            </button>
          )}
          <button type="button" className="btn btn--small btn--icon" onClick={onHelp} title="Scorciatoie da tastiera (?)" aria-label="Scorciatoie da tastiera">
            ?
          </button>
          <details className="menu" ref={menu}>
            <summary className="btn btn--small">Progetto</summary>
            {/* Scelta una voce, il menu si richiude. */}
            <div className="menu__list" onClick={() => menu.current?.removeAttribute("open")}>
              <p className="menu__note">{folder ? `cartella: ${folder}` : "nessuna cartella"}</p>
              <button type="button" className="menu__item" onClick={newProject}>
                Nuovo progetto…
              </button>
              {editor.canOpenFolders ? (
                <>
                  <button type="button" className="menu__item" onClick={() => void editor.openFolder()}>
                    Apri progetto…
                  </button>
                  <button type="button" className="menu__item" onClick={() => void editor.saveToFolder()}>
                    {folder ? "Salva in un'altra cartella…" : "Salva in una cartella…"}
                  </button>
                </>
              ) : (
                <p className="menu__note">Questo browser non apre cartelle: per salvare il progetto serve Chrome o Edge.</p>
              )}
            </div>
          </details>
        </div>
      </div>

      {(tone === "error" || (editor.recoveredAt && !folder)) && (
        <p className={`bar__status${tone === "error" ? " bar__status--error" : ""}`}>
          {tone === "error" && statusText(status, folder)}
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
      )}

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
