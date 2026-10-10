import { t } from "../i18n.js";
import type { Balloon, TextRun, Tail } from "@comic-builder/core";
import { Section } from "./Section.js";
import { NoteButton } from "./NoteButton.js";

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
  /** È il balloon scelto sulla pagina: si distingue dagli altri. */
  selected?: boolean;
  onSelect?: () => void;
  /** Una nota su questa battuta, nel changelog delle revisioni. */
  onAnnotate?: (text: string) => void;
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
export function BalloonEditor({ balloon, selected, onSelect, shown, target, onText, onAnchor, onTail, onScale, onReset, onRemove, onCommit, onAnnotate }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");
  const tailTarget = shown.tail.target ?? { x: 0.5, y: 0.5 };
  const tuned = target !== null && balloon.per_target[target] !== undefined;

  return (
    <div id={`balloon-${balloon.id}`} className={`card${selected ? " card--selected" : ""}`} onFocus={onSelect}>
      <p className="card__title card__title--row">
        <span title={balloon.id}>
          {balloon.type}
          {balloon.speaker.ref ? ` · ${balloon.speaker.ref}` : t(" · fuori campo")}
          {balloon.rev > 0 && <span className="muted"> · rev {balloon.rev}</span>}
        </span>
        <button type="button" className="link-btn" onClick={onRemove}>
          {t("elimina")}</button>
      </p>

      <div className="stack">
        {target && (
          <p className={`format-note${tuned ? " format-note--tuned" : ""}`}>
            {tuned ? (
              <>
                {t("In")}{" "}<code>{target}</code> {" "}{t("ha una posizione sua.")}{" "}
                <button type="button" className="link-btn" onClick={onReset}>
                  {t("ripristina")}</button>
              </>
            ) : (
              <>
                {t("In")}{" "}<code>{target}</code> {" "}{t("segue la pagina principale: spostarlo qui vale solo per questo formato.")}</>
            )}
          </p>
        )}
        <label className="field">
          <span className="field__label">{t("testo")}{target ? t(" (uguale in tutti i formati)") : ""}</span>
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

        <label className="field field--inline">
          <span className="field__label">{t("corpo")}{target ? t(" in {0}", target) : ""}</span>
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

        <Section id="balloon-fine" title={t("posizione e coda, in numeri")}>
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
              <span className="field__label">{t("coda x")}</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={round(tailTarget.x)}
                onChange={(e) => onTail({ mode: "manual", target: { ...tailTarget, x: Number(e.target.value) } })}
                onBlur={onCommit}
              />
            </label>
            <label className="field">
              <span className="field__label">{t("coda y")}</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={round(tailTarget.y)}
                onChange={(e) => onTail({ mode: "manual", target: { ...tailTarget, y: Number(e.target.value) } })}
                onBlur={onCommit}
              />
            </label>
          </div>
        </Section>
        {onAnnotate && <NoteButton what="la battuta" onAdd={onAnnotate} />}
      </div>
    </div>
  );
}
