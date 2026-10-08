import { useState } from "react";

interface Props {
  /** Cosa si annota, per l'etichetta: «la vignetta», «la pagina», «la battuta». */
  what: string;
  onAdd: (text: string) => void;
  /** Voci ancora aperte su questo bersaglio. */
  open?: number;
  onShow?: () => void;
}

/**
 * Una nota scritta dove nasce: sulla vignetta, sulla battuta o sulla pagina
 * che si ha davanti. Finisce nel changelog del capitolo come ogni altra
 * revisione, e resta aperta finché non la si chiude dicendo cosa si è fatto.
 */
export function NoteButton({ what, onAdd, open = 0, onShow }: Props) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");

  function add() {
    const clean = text.trim();
    if (!clean) return;
    onAdd(clean);
    setText("");
    setWriting(false);
  }

  return (
    <div className="note-button">
      <div className="tool-row tool-row--tight">
        <button type="button" className="link-btn" aria-expanded={writing} onClick={() => setWriting((v) => !v)}>
          {writing ? "annulla" : `annota ${what}…`}
        </button>
        {open > 0 && onShow && (
          <button type="button" className="link-btn note-button__open" onClick={onShow}>
            {open === 1 ? "1 revisione aperta" : `${open} revisioni aperte`}
          </button>
        )}
      </div>
      {writing && (
        <div className="tool-row tool-row--tight">
          <input
            type="text"
            autoFocus
            value={text}
            placeholder="Cosa c'è da rivedere"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setWriting(false);
            }}
          />
          <button type="button" className="btn btn--small" disabled={!text.trim()} onClick={add}>
            Aggiungi
          </button>
        </div>
      )}
    </div>
  );
}
