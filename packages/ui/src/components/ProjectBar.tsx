import { useRef } from "react";
import type { Chapter } from "@comic-builder/core";
import type { ProjectEditor, SaveStatus } from "../editor/useProjectEditor.js";
import type { Area } from "./Workspace.js";
import { Tabs } from "./Tabs.js";
import { useLanguage } from "../useLanguage.js";
import { t } from "../i18n.js";

function statusText(status: SaveStatus, folder: string | null): string {
  switch (status.kind) {
    case "memory":
      return t("Non salvato: il progetto vive solo in questa scheda.");
    case "pending":
      return t("Modifiche in attesa di salvataggio…");
    case "saving":
      return t("Salvo…");
    case "saved":
      return t("Salvato in «{0}» alle {1}.", folder ?? "?", status.at.toLocaleTimeString());
    case "error":
      return t("Salvataggio non riuscito: {0}", status.message);
    case "locked-out":
      return status.message;
  }
}

/** Lo stato in due parole, per la pillola: il testo intero sta nel `title`. */
function statusShort(status: SaveStatus): string {
  switch (status.kind) {
    case "memory":
      return t("non salvato");
    case "pending":
      return t("da salvare…");
    case "saving":
      return t("salvo…");
    case "saved":
      return t("salvato {0}", status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    case "error":
      return t("salvataggio fallito");
    case "locked-out":
      return t("sola lettura");
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
  onConfiguration: () => void;
  /** Solo nell'app desktop: la procedura guidata dei modelli locali. */
  onLocalModels?: () => void;
}

/**
 * La barra: dove si è (opera, capitolo, area di lavoro) e se il lavoro è al
 * sicuro. Una riga; avvisi ed errori ne aggiungono una solo quando ci sono.
 */
export function ProjectBar({ editor, chapters, chapterId, onSelectChapter, area, onArea, openRevisions, onHelp, onConfiguration, onLocalModels }: Props) {
  const [language, onLanguage] = useLanguage();
  const { status, folder } = editor;
  const tone = status.kind === "error" || status.kind === "locked-out" ? "error" : status.kind === "memory" ? "warn" : status.kind === "saved" ? "ok" : "busy";
  const menu = useRef<HTMLDetailsElement>(null);
  const ordered = [...chapters].sort((a, b) => a.number - b.number);

  function newProject() {
    const unsaved = !folder && editor.canUndo;
    const title = window.prompt(
      unsaved ? t("Nome del nuovo progetto?\n\nAttenzione: il progetto aperto non è salvato in una cartella e andrà perso.") : t("Nome del nuovo progetto?"),
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
            aria-label={t("Nome del progetto")}
            title={t("Clicca per rinominare il progetto")}
            size={Math.max(8, editor.doc.project.title.length)}
            onChange={(e) => editor.run({ type: "project.rename", title: e.target.value }, { gesture: "project-rename" })}
            onBlur={(e) => {
              if (!e.target.value.trim()) editor.run({ type: "project.rename", title: "Senza titolo" }, { gesture: "project-rename" });
              editor.endGesture();
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <select className="bar__chapter" value={chapterId} onChange={(e) => onSelectChapter(e.target.value)} aria-label={t("Capitolo aperto")} title={t("Capitolo aperto")}>
            {ordered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}. {c.title || t("senza titolo")}
              </option>
            ))}
          </select>
        </div>

        <Tabs<Area>
          label={t("Area di lavoro")}
          className="tabs--areas"
          value={area}
          onChange={onArea}
          items={[
            { id: "copione", label: t("Copione"), title: t("Capitoli, testo e spoglio") },
            { id: "pagine", label: t("Pagine"), title: t("Pagine, vignette, balloon, arte") },
            { id: "personaggi", label: t("Riferimenti"), title: t("Stile, personaggi e luoghi dell'opera: ciò che tiene uguali le vignette") },
            { id: "revisioni", label: t("Revisioni"), badge: openRevisions, title: t("Correzioni dello sceneggiatore, trova e sostituisci") },
            { id: "export", label: "Export", title: t("Il capitolo nei formati del progetto") },
          ]}
        />

        <div className="bar__tools">
          <select className="bar__language" value={language} onChange={(event) => onLanguage(event.target.value === "en" ? "en" : "it")} aria-label={t("Lingua dell'interfaccia")} title={t("Lingua dell'interfaccia")}>
            <option value="it" lang="it">Italiano</option>
            <option value="en" lang="en">English</option>
          </select>
          <button type="button" className="btn btn--small btn--icon" onClick={editor.undo} disabled={!editor.canUndo} title={`${editor.undoLabel ? t("Annulla «{0}»", editor.undoLabel) : t("Annulla")} (${mod}Z)`} aria-label={t("Annulla")}>
            ↶
          </button>
          <button type="button" className="btn btn--small btn--icon" onClick={editor.redo} disabled={!editor.canRedo} title={t("Ripeti ({0}Shift+Z)", mod)} aria-label={t("Ripeti")}>
            ↷
          </button>
          <button
            type="button"
            className={`btn btn--small${status.kind === "memory" ? " btn--primary" : ""}`}
            onClick={() => void editor.save()}
            disabled={status.kind === "saved" || status.kind === "saving" || status.kind === "locked-out"}
            title={`${folder ? t("Salva in «{0}»", folder) : t("Salva il progetto in una cartella")} (${mod}S)`}
          >
            {folder ? t("Salva") : t("Salva…")}
          </button>
          <span className={`pill pill--${tone}`} role="status" title={statusText(status, folder)}>
            {statusShort(status)}
          </span>
          {editor.reopenable && (
            <button type="button" className="btn btn--small btn--primary" onClick={() => void editor.reopen()} title={t("Il browser chiede di nuovo il permesso per la cartella")}>
              {t("Riapri «")}{editor.reopenable}»
            </button>
          )}
          <button type="button" className="btn btn--small btn--icon" onClick={onHelp} title={t("Scorciatoie da tastiera (?)")} aria-label={t("Scorciatoie da tastiera")}>
            ?
          </button>
          <details className="menu" ref={menu}>
            <summary className="btn btn--small">{t("Progetto")}</summary>
            {/* Scelta una voce, il menu si richiude. */}
            <div className="menu__list" onClick={() => menu.current?.removeAttribute("open")}>
              <p className="menu__note">{folder ? t("cartella: {0}", folder) : t("nessuna cartella")}</p>
              <button type="button" className="menu__item" onClick={newProject}>
                {t("Nuovo progetto…")}</button>
              {editor.canOpenFolders ? (
                <>
                  <button type="button" className="menu__item" onClick={() => void editor.openFolder()}>
                    {t("Apri progetto…")}</button>
                  <button type="button" className="menu__item" onClick={() => void editor.saveToFolder()}>
                    {folder ? t("Salva in un'altra cartella…") : t("Salva in una cartella…")}
                  </button>
                </>
              ) : (
                <p className="menu__note">{t("Questo browser non apre cartelle: per salvare il progetto serve Chrome o Edge.")}</p>
              )}
              <button type="button" className="menu__item" onClick={onConfiguration}>
                {t("Configurazione…")}</button>
              {onLocalModels && (
                <button type="button" className="menu__item" onClick={onLocalModels}>
                  {t("Modelli locali…")}</button>
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
              {t("Ripristinato il lavoro di questa scheda (")}{editor.recoveredAt.toLocaleString()}).{" "}
              <button type="button" className="link-btn" onClick={() => void editor.startOver()}>
                {t("ricomincia da capo")}</button>
            </>
          )}
        </p>
      )}

      {editor.notice && (
        <p className="bar__notice" role="alert">
          {editor.notice}
          <button type="button" className="bar__dismiss" onClick={editor.dismissNotice} aria-label={t("Chiudi")}>
            ×
          </button>
        </p>
      )}
    </header>
  );
}
