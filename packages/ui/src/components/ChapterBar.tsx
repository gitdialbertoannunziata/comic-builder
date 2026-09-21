import type { Chapter, Command } from "@comic-builder/core";

interface Props {
  chapters: readonly Chapter[];
  currentId: string;
  onSelect: (chapterId: string) => void;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Id che avrà il prossimo capitolo, per selezionarlo appena creato. */
  nextId: string;
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
export function ChapterBar({ chapters, currentId, onSelect, run, endGesture, nextId }: Props) {
  const current = chapters.find((c) => c.id === currentId);
  const ordered = [...chapters].sort((a, b) => a.number - b.number);

  return (
    <div className="stack chapters">
      <div className="chapter-list">
        {ordered.map((c) => (
          <button key={c.id} type="button" className="chapter-chip" aria-pressed={c.id === currentId} onClick={() => onSelect(c.id)} title={`${c.title} — ${STATUS_LABEL[c.status]}, ${c.pages.length} pagine`}>
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
          title="Aggiungi un capitolo all'opera"
        >
          + capitolo
        </button>
      </div>
      {current && (
        <div className="chapter-fields">
          <label className="field">
            <span className="field__label">titolo del capitolo {current.number}</span>
            <input
              type="text"
              value={current.title}
              onChange={(e) => run({ type: "chapter.update", chapterId: current.id, title: e.target.value }, { gesture: `${current.id}:title` })}
              onBlur={endGesture}
            />
          </label>
          <label className="field">
            <span className="field__label">stato</span>
            <select value={current.status} onChange={(e) => run({ type: "chapter.update", chapterId: current.id, status: e.target.value as Chapter["status"] })}>
              {(Object.keys(STATUS_LABEL) as Chapter["status"][]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
