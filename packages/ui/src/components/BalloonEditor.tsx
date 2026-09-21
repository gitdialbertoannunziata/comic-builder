import type { Balloon, TextRun, Tail } from "@comic-builder/core";

interface Props {
  balloon: Balloon;
  onText: (text: TextRun[]) => void;
  onAnchor: (anchor: { x: number; y: number }) => void;
  onTail: (tail: Tail) => void;
  onRemove: () => void;
  /** Fine di un'interazione continua (digitazione, trascinamento): chiude il passo di undo. */
  onCommit: () => void;
}

/**
 * v1: il testo si modifica come un unico run, senza enfasi per-parola —
 * un editor di run ricchi (em: bold|italic|small) resta un affinamento
 * successivo. Ancora e coda si spostano anche trascinando sulla pagina;
 * i numeri qui servono alla regolazione fine.
 */
export function BalloonEditor({ balloon, onText, onAnchor, onTail, onRemove, onCommit }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");
  const target = balloon.tail.target ?? { x: 0.5, y: 0.5 };

  return (
    <div className="card">
      <p className="card__title card__title--row">
        <span>
          {balloon.id} · {balloon.type}
          {balloon.speaker.ref ? ` · ${balloon.speaker.ref}` : " · fuori campo"}
          {balloon.rev > 0 && <span className="muted"> · rev {balloon.rev}</span>}
        </span>
        <button type="button" className="link-btn" onClick={onRemove}>
          elimina
        </button>
      </p>

      <div className="stack">
        <label className="field">
          <span className="field__label">testo</span>
          <textarea
            value={plainText}
            rows={2}
            onChange={(e) => {
              // Un testo vuoto il comando lo rifiuta: si elimina il balloon, non lo si svuota.
              if (e.target.value.length > 0) onText([{ t: e.target.value }]);
            }}
            onBlur={onCommit}
          />
        </label>

        <div className="grid-2">
          <label className="field">
            <span className="field__label">anchor x</span>
            <input type="number" step={0.01} min={0} max={1} value={balloon.anchor.x} onChange={(e) => onAnchor({ ...balloon.anchor, x: Number(e.target.value) })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">anchor y</span>
            <input type="number" step={0.01} min={0} max={1} value={balloon.anchor.y} onChange={(e) => onAnchor({ ...balloon.anchor, y: Number(e.target.value) })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">coda x</span>
            <input type="number" step={0.01} min={0} max={1} value={target.x} onChange={(e) => onTail({ mode: "manual", target: { ...target, x: Number(e.target.value) } })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">coda y</span>
            <input type="number" step={0.01} min={0} max={1} value={target.y} onChange={(e) => onTail({ mode: "manual", target: { ...target, y: Number(e.target.value) } })} onBlur={onCommit} />
          </label>
        </div>
      </div>
    </div>
  );
}
