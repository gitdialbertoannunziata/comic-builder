import { t } from "../i18n.js";
import type { KeyboardEvent } from "react";
import type { Chapter, Command } from "@comic-builder/core";
import { listArrows, refocus } from "../keyboard.js";

interface Props {
  chapters: readonly Chapter[];
  currentId: string;
  onSelect: (chapterId: string) => void;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Id che avrà il prossimo capitolo, per selezionarlo appena creato. */
  nextId: string;
  /** Cosa ha il capitolo aperto oltre alle pagine: lo si dice prima di eliminarlo. */
  content: { script: boolean; revisions: number; lessons: number };
}

const STATUS_LABEL: Record<Chapter["status"], string> = {
  planned: "da fare",
  scripting: "spoglio",
  "in-production": "in lavorazione",
  done: "finito",
};

/**
 * Il livello sopra le pagine: l'opera ha più capitoli (§5.3), e ognuno ha
 * il suo copione, le sue pagine, le sue revisioni. Personaggi e stile sono
 * dell'opera, e valgono per tutti.
 */
export function ChapterBar({ chapters, currentId, onSelect, run, endGesture, nextId, content }: Props) {
  const current = chapters.find((c) => c.id === currentId);
  const ordered = [...chapters].sort((a, b) => a.number - b.number);
  const index = ordered.findIndex((c) => c.id === currentId);

  function move(step: 1 | -1): boolean {
    const to = index + step;
    return current !== undefined && to >= 0 && to < ordered.length && run({ type: "chapter.move", chapterId: current.id, toIndex: to });
  }

  /** Sul capitolo in elenco: frecce per passare al vicino, Alt+frecce per spostarlo, Canc per eliminarlo. */
  function onKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.matches("[data-item]")) return;
    const list = event.currentTarget;
    const steps: Record<string, 1 | -1 | undefined> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    const step = event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey ? steps[event.key] : undefined;
    if (step) {
      event.preventDefault();
      if (move(step)) refocus(list, '[aria-pressed="true"]');
    } else if (event.key === "Delete") {
      event.preventDefault();
      if (!event.repeat && remove()) refocus(list, '[aria-pressed="true"]');
    } else {
      listArrows(event);
    }
  }

  /** Un capitolo vuoto se ne va e basta, come una pagina; di uno che ha del lavoro dentro si dice prima cosa si perde. */
  function remove(): boolean {
    if (!current || ordered.length <= 1) return false;
    const lost = [
      current.pages.length === 1 ? t("la sua pagina") : current.pages.length > 1 ? t("le sue {0} pagine", current.pages.length) : null,
      content.script ? t("il copione") : null,
      content.revisions === 1 ? t("una revisione") : content.revisions > 1 ? t("{0} revisioni", content.revisions) : null,
    ].filter((part): part is string => part !== null);
    if (lost.length > 0) {
      const list = lost.length > 1 ? t("{0} e {1}", lost.slice(0, -1).join(", "), lost.at(-1)) : lost[0];
      const kept = [
        current.pages.length > 0 ? t("Le immagini delle vignette (art/, renders/) non si cancellano.") : null,
        content.lessons === 1 ? t("La sua regola «vale per la serie» passa fra le regole della serie.") : content.lessons > 1 ? t("Le sue {0} regole «vale per la serie» passano fra le regole della serie.", content.lessons) : null,
      ].filter(Boolean);
      const message = [t("Eliminare il capitolo {0} «{1}»?", current.number, current.title), [t("Se ne vanno {0}.", list), ...kept].join(" "), t("Ctrl+Z lo riporta.")].join("\n\n");
      if (!window.confirm(message)) return false;
    }
    const fallback = ordered[index + 1] ?? ordered[index - 1];
    if (!fallback || !run({ type: "chapter.remove", chapterId: current.id })) return false;
    onSelect(fallback.id);
    return true;
  }

  return (
    <div className="stack chapters">
      <div className="chapter-list" onKeyDown={onKeys}>
        {ordered.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chapter-chip"
            data-item
            tabIndex={c.id === currentId ? 0 : -1}
            aria-pressed={c.id === currentId}
            onClick={() => onSelect(c.id)}
            title={t("{0} — {1}, {2} pagine", c.title, STATUS_LABEL[c.status], c.pages.length)}
          >
            <strong>{c.number}</strong>
            <span>{c.title}</span>
            <span className="chapter-chip__meta">{c.pages.length > 0 ? `${c.pages.length} p.` : "vuoto"}</span>
          </button>
        ))}
        <button
          type="button"
          className="chapter-chip chapter-chip--add"
          onClick={() => {
            if (run({ type: "chapter.add", title: "" })) onSelect(nextId);
          }}
          title={t("Aggiungi un capitolo all'opera")}
        >
          {t("+ capitolo")}</button>
      </div>
      {current && (
        <>
          <div className="chapter-fields">
            <label className="field">
              <span className="field__label">{t("titolo del capitolo")}{" "}{current.number}</span>
              <input
                type="text"
                value={current.title}
                onChange={(e) => run({ type: "chapter.update", chapterId: current.id, title: e.target.value }, { gesture: `${current.id}:title` })}
                onBlur={endGesture}
              />
            </label>
            <label className="field">
              <span className="field__label">{t("stato")}</span>
              <select value={current.status} onChange={(e) => run({ type: "chapter.update", chapterId: current.id, status: e.target.value as Chapter["status"] })}>
                {(Object.keys(STATUS_LABEL) as Chapter["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_LABEL[s])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="tool-row">
            <button type="button" className="btn btn--small" disabled={index <= 0} onClick={() => move(-1)} title={t("Sposta il capitolo prima del precedente: i numeri seguono (Alt+↑ sul capitolo)")}>
              {t("↑ prima")}</button>
            <button type="button" className="btn btn--small" disabled={index >= ordered.length - 1} onClick={() => move(1)} title={t("Sposta il capitolo dopo il successivo: i numeri seguono (Alt+↓ sul capitolo)")}>
              {t("dopo ↓")}</button>
            <button type="button" className="btn btn--small" disabled={ordered.length <= 1} onClick={remove} title={ordered.length <= 1 ? t("Un'opera ha almeno un capitolo") : t("Elimina il capitolo dall'opera (Canc sul capitolo)")}>
              {t("elimina")}</button>
          </div>
        </>
      )}
    </div>
  );
}
