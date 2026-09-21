import type { Balloon, TextRun, Tail } from "@comic-builder/core";

interface Props {
  balloon: Balloon;
  /** Il balloon com'è nel formato mostrato (override applicati): i numeri mostrano questo. */
  shown: Balloon;
  /** Formato mostrato, se non è il principale: posizione, coda e corpo diventano override. */
  target: string | null;
  onScale: (fontScale: number) => void;
  onReset: () => void;
  onText: (text: TextRun[]) => void;
  onAnchor: (anchor: { x: number; y: number }) => void;
  onTail: (tail: Tail) => void;
  onRemove: () => void;
  /** Fine di un'interazione continua (digitazione, trascinamento): chiude il passo di undo. */
  onCommit: () => void;
}

/** Tre decimali bastano a una posizione normalizzata, e un trascinamento non riempie il campo di cifre. */
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * v1: il testo si modifica come un unico run, senza enfasi per-parola —
 * un editor di run ricchi (em: bold|italic|small) resta un affinamento
 * successivo. Ancora e coda si spostano anche trascinando sulla pagina;
 * i numeri qui servono alla regolazione fine.
 */
export function BalloonEditor({ balloon, shown, target, onText, onAnchor, onTail, onScale, onReset, onRemove, onCommit }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");
  const tailTarget = shown.tail.target ?? { x: 0.5, y: 0.5 };
  const tuned = target !== null && balloon.per_target[target] !== undefined;

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
        {target && (
          <p className={`format-note${tuned ? " format-note--tuned" : ""}`}>
            {tuned ? (
              <>
                In <code>{target}</code> ha una posizione sua.{" "}
                <button type="button" className="link-btn" onClick={onReset}>
                  ripristina
                </button>
              </>
            ) : (
              <>
                In <code>{target}</code> segue la pagina principale: spostarlo qui vale solo per questo formato.
              </>
            )}
          </p>
        )}
        <label className="field">
          <span className="field__label">testo{target ? " (uguale in tutti i formati)" : ""}</span>
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
            <input type="number" step={0.01} min={0} max={1} value={round(shown.anchor.x)} onChange={(e) => onAnchor({ ...shown.anchor, x: Number(e.target.value) })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">anchor y</span>
            <input type="number" step={0.01} min={0} max={1} value={round(shown.anchor.y)} onChange={(e) => onAnchor({ ...shown.anchor, y: Number(e.target.value) })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">coda x</span>
            <input type="number" step={0.01} min={0} max={1} value={round(tailTarget.x)} onChange={(e) => onTail({ mode: "manual", target: { ...tailTarget, x: Number(e.target.value) } })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">coda y</span>
            <input type="number" step={0.01} min={0} max={1} value={round(tailTarget.y)} onChange={(e) => onTail({ mode: "manual", target: { ...tailTarget, y: Number(e.target.value) } })} onBlur={onCommit} />
          </label>
          <label className="field">
            <span className="field__label">corpo{target ? ` in ${target}` : ""}</span>
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={2}
              value={shown.font_scale}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value > 0) onScale(value);
              }}
              onBlur={onCommit}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
