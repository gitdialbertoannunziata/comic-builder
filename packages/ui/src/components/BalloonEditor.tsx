import { t } from "../i18n.js";
import { balloonShape, shapePath, type Balloon, type BalloonPatch, type BalloonShape, type BalloonSize, type BalloonType, type TextRun, type Tail } from "@comic-builder/core";
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
  /** Tipo, forma e rotazione: valgono in tutti i formati. */
  onUpdate: (patch: BalloonPatch) => void;
  /** Dimensioni scelte a mano; `null` torna a un balloon grande quanto il testo. */
  onResize: (size: BalloonSize | null) => void;
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

const SHAPES: ReadonlyArray<{ value: BalloonShape; label: string; title: string }> = [
  { value: "rounded", label: "Classico", title: "Rettangolo arrotondato: il balloon di sempre" },
  { value: "ellipse", label: "Ovale", title: "Ovale: il balloon tondo classico" },
  { value: "rect", label: "Riquadro", title: "Riquadro ad angoli vivi: didascalie e voci narranti" },
  { value: "cloud", label: "Nuvola", title: "Nuvola: pensieri e sogni" },
  { value: "burst", label: "Urlo", title: "Esplosione a punte: urla ed esclamazioni" },
  { value: "spiky", label: "Elettrico", title: "Bordo a dentini: radio, telefono, voci elettroniche" },
  { value: "wavy", label: "Tremante", title: "Bordo ondulato: voce che trema, debole o spaventata" },
  { value: "none", label: "Senza", title: "Solo testo, senza contorno: effetti sonori e lettering libero" },
];

const TYPES: readonly BalloonType[] = ["speech", "thought", "whisper", "shout", "caption", "sfx", "offpanel"];

const TYPE_LABELS: Record<BalloonType, string> = {
  speech: "parlato",
  thought: "pensiero",
  whisper: "sussurro",
  shout: "urlo",
  caption: "didascalia",
  sfx: "effetto sonoro",
  offpanel: "fuori campo",
};

/** La miniatura di una forma, disegnata con la stessa geometria del renderer: si sceglie ciò che si otterrà. */
function ShapeIcon({ shape }: { shape: BalloonShape }) {
  const box = { x: 5, y: 5, width: 34, height: 22 };
  let outline;
  if (shape === "rounded" || shape === "rect" || shape === "none") {
    const radius = shape === "rect" ? 0 : 7;
    outline = <rect {...box} rx={radius} className={shape === "none" ? "shape-icon__ghost" : undefined} />;
  } else if (shape === "ellipse") {
    outline = <ellipse cx={22} cy={16} rx={17} ry={11} />;
  } else {
    outline = <path d={shapePath(shape, box) ?? ""} strokeLinejoin="round" />;
  }
  return (
    <svg className="shape-icon" viewBox="0 0 44 32" aria-hidden="true">
      {outline}
      {shape === "none" && <text x={22} y={20} textAnchor="middle">Aa</text>}
    </svg>
  );
}

/**
 * v1: il testo si modifica come un unico run, senza enfasi per-parola —
 * un editor di run ricchi (em: bold|italic|small) resta un affinamento
 * successivo. Ancora e coda si spostano anche trascinando sulla pagina;
 * i numeri qui servono alla regolazione fine.
 */
export function BalloonEditor({ balloon, selected, onSelect, shown, target, onText, onAnchor, onTail, onUpdate, onResize, onScale, onReset, onRemove, onCommit, onAnnotate }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");
  const tailTarget = shown.tail.target ?? { x: 0.5, y: 0.5 };
  const shape = balloonShape(balloon);
  const rotation = balloon.rotation ?? 0;
  const tailable = balloon.type !== "caption" && balloon.type !== "sfx" && shape !== "none";
  const tail = shown.tail;
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

        <div className="field">
          <span className="field__label">{t("forma")}</span>
          <div className="shape-picker" role="group" aria-label={t("forma")}>
            {SHAPES.map((option) => (
              <button
                key={option.value}
                type="button"
                className="shape-picker__option"
                aria-pressed={option.value === shape}
                title={t(option.title)}
                onClick={() => onUpdate({ shape: option.value })}
              >
                <ShapeIcon shape={option.value} />
                <span>{t(option.label)}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="field field--inline">
          <span className="field__label">{t("tipo")}</span>
          <select value={balloon.type} onChange={(e) => onUpdate({ type: e.target.value as BalloonType })}>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE_LABELS[type])}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field__label">
            {t("rotazione")} <span className="muted">{rotation}°</span>
          </span>
          <div className="range-row">
            <input
              type="range"
              min={-45}
              max={45}
              step={1}
              value={Math.max(-45, Math.min(45, rotation))}
              onChange={(e) => onUpdate({ rotation: Number(e.target.value) })}
              onPointerUp={onCommit}
              onBlur={onCommit}
              aria-label={t("rotazione")}
            />
            <button type="button" className="link-btn" disabled={rotation === 0} onClick={() => onUpdate({ rotation: 0 })}>
              {t("raddrizza")}
            </button>
          </div>
        </div>

        <p className="field__hint">
          {shown.size ? (
            <>
              {t("Dimensioni su misura{0}.", target ? t(" in {0}", target) : "")}{" "}
              <button type="button" className="link-btn" onClick={() => onResize(null)}>
                {t("adatta al testo")}
              </button>
            </>
          ) : (
            t("Grande quanto il testo: trascina le maniglie sulla pagina per dargli la forma che vuoi.")
          )}
        </p>

        {tailable && (
          <div className="field">
            <label className="field field--row">
              <input type="checkbox" checked={tail.mode !== "none"} onChange={(e) => onTail({ ...tail, mode: e.target.checked ? (tail.target ? "manual" : "auto") : "none" })} />
              <span>{t("coda")}</span>
            </label>
            {tail.mode !== "none" && (
              <div className="tail-options">
                <label className="field field--row">
                  <input type="checkbox" checked={tail.bubbles ?? false} onChange={(e) => onTail({ ...tail, bubbles: e.target.checked || undefined })} />
                  <span>{t("a pallini (pensiero)")}</span>
                </label>
                <label className="field">
                  <span className="field__label">{t("larghezza")}</span>
                  <input
                    type="range"
                    min={0.3}
                    max={4}
                    step={0.1}
                    value={tail.width ?? 1}
                    onChange={(e) => onTail({ ...tail, width: Number(e.target.value) })}
                    onPointerUp={onCommit}
                    onBlur={onCommit}
                  />
                </label>
                <label className="field">
                  <span className="field__label">{t("curva")}</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={tail.curve ?? 0}
                    onChange={(e) => onTail({ ...tail, curve: Number(e.target.value) || undefined })}
                    onPointerUp={onCommit}
                    onBlur={onCommit}
                  />
                </label>
              </div>
            )}
          </div>
        )}

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
                onChange={(e) => onTail({ ...tail, mode: "manual", target: { ...tailTarget, x: Number(e.target.value) } })}
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
                onChange={(e) => onTail({ ...tail, mode: "manual", target: { ...tailTarget, y: Number(e.target.value) } })}
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
