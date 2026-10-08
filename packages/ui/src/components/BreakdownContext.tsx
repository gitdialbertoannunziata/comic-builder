import { useMemo, useState } from "react";
import { chapterContext, seriesLessons, type Command, type ProjectDoc } from "@comic-builder/core";
import { breakdownSystemPrompt, breakdownUserPrompt, splitScript } from "@comic-builder/llm";

interface Props {
  doc: ProjectDoc;
  chapterId: string;
  script: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
}

/**
 * Ciò che tiene insieme i capitoli di un'opera nello spoglio: le regole
 * della serie, scritte dall'autore, e — per non doversi fidare — il testo
 * esatto che il modello riceve. È costruito con le stesse funzioni dello
 * spoglio: ciò che si legge qui è ciò che parte.
 */
export function BreakdownContext({ doc, chapterId, script, run, endGesture }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);
  const context = useMemo(() => chapterContext(doc, chapterId), [doc, chapterId]);
  const lessons = useMemo(() => seriesLessons(doc), [doc]);
  const chapterNumber = (id: string) => doc.chapters.chapters.find((c) => c.id === id)?.number ?? id;
  const preview = useMemo(() => {
    if (!showPrompt) return null;
    const parts = splitScript(script, 6000);
    const first = parts[0];
    return {
      parts: parts.length,
      system: breakdownSystemPrompt({ seriesNotes: context.notes, lessons: context.lessons }),
      user: first
        ? breakdownUserPrompt(first.text, {
            firstLine: first.firstLine,
            knownCharacters: [],
            characters: context.characters,
            locations: context.locations,
            previously: context.previously,
            part: { index: 0, total: parts.length, continuation: false },
          })
        : "(copione vuoto)",
    };
  }, [showPrompt, script, context]);

  const withSheet = context.characters.filter((c) => c.appearance || c.summary || c.wardrobe).length;

  return (
    <div className="stack breakdown-context">
      <label className="field">
        <span className="field__label">regole della serie</span>
        <textarea
          rows={4}
          value={doc.project.series_notes}
          placeholder={"Valgono per ogni capitolo. Per esempio:\nDialoghi brevi, al massimo due battute per vignetta.\nSara non dice mai parolacce; Elio parla in dialetto.\nLe scene al faro si aprono sempre con un campo lungo."}
          onChange={(e) => run({ type: "project.notes", notes: e.target.value }, { gesture: "series-notes" })}
          onBlur={endGesture}
        />
      </label>
      {lessons.length > 0 && (
        <div className="field">
          <span className="field__label">imparato dalle revisioni</span>
          <ul className="lesson-list">
            {lessons.map((l) => (
              <li key={`${l.chapterId}:${l.id}`}>
                {l.text}{" "}
                <span className="muted">
                  (cap. {chapterNumber(l.chapterId)}, {l.id})
                </span>{" "}
                <button type="button" className="link-btn" onClick={() => run({ type: "revision.lesson", chapterId: l.chapterId, id: l.id, lesson: null })}>
                  togli
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="field__hint">
        Allo spoglio arrivano anche {context.characters.length} personaggi ({withSheet} con scheda: aspetto e costumi),{" "}
        {context.locations.length} luoghi già visti{context.previously ? " e il riassunto del capitolo precedente" : ""}.
        {lessons.length === 0 && " Una correzione che vale per tutta la serie si segna in Revisioni, con «vale per la serie…»: da lì arriva qui."}
      </p>
      <button type="button" className="link-btn" onClick={() => setShowPrompt((v) => !v)}>
        {showPrompt ? "nascondi cosa riceve il modello" : "cosa riceve il modello"}
      </button>
      {preview && (
        <div className="stack">
          <span className="field__label">istruzioni di sistema</span>
          <pre className="prompt-text">{preview.system}</pre>
          <span className="field__label">copione{preview.parts > 1 ? ` — parte 1 di ${preview.parts}` : ""}</span>
          <pre className="prompt-text">{preview.user}</pre>
        </div>
      )}
    </div>
  );
}
