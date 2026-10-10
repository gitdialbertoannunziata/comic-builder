import { t } from "../i18n.js";
import { useEffect, useState } from "react";
import { MAX_STYLE_REFERENCES, STYLE_PRESETS, styleChosen, styleText, type Command, type ProjectDoc, type ProjectStore } from "@comic-builder/core";
import { ReferenceImages } from "./ReferenceImages.js";
import { listArrows } from "../keyboard.js";

interface Props {
  doc: ProjectDoc;
  store: ProjectStore;
  run: (command: Command, options?: { gesture?: string }) => boolean;
}

/** Il testo di un campo, spezzato come lo vuole lo schema: frammenti separati da virgole o a capo. */
const fragments = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

/**
 * Lo stile dell'opera: uno per tutta la serie. È la prima riga di ogni
 * prompt, uguale parola per parola, e le tavole spuntate si allegano a ogni
 * generazione — vignette, schede dei personaggi, tavole dei luoghi. Senza,
 * ogni immagine sceglie uno stile suo e il capitolo diventa un collage.
 */
export function StylePanel({ doc, store, run }: Props) {
  const style = doc.project.style;
  // Si scrive in locale e si salva uscendo dal campo: spezzare a ogni tasto mangerebbe la virgola appena battuta.
  const [text, setText] = useState(style.positive.join(", "));
  const [avoid, setAvoid] = useState(style.negative.join(", "));
  useEffect(() => {
    setText(style.positive.join(", "));
    setAvoid(style.negative.join(", "));
  }, [style.positive, style.negative]);

  const chosen = styleChosen(style);
  const current = styleText(style);
  const used = style.references.filter((r) => r.use).length;

  return (
    <div className="stack">
      <div className="card">
        <p className="card__title">{t("da dove partire")}</p>
        <div className="style-presets" onKeyDown={(e) => void listArrows(e)}>
          {STYLE_PRESETS.map((preset, i) => {
            const active = chosen && current === preset.positive;
            return (
              <button
                key={preset.id}
                type="button"
                className="style-preset"
                data-item
                tabIndex={active || (i === 0 && !STYLE_PRESETS.some((p) => p.positive === current)) ? 0 : -1}
                aria-pressed={active}
                onClick={() => run({ type: "project.style", positive: fragments(preset.positive), preset: preset.id })}
                title={preset.positive}
              >
                <strong>{t(preset.label)}</strong>
                <span>{t(preset.hint)}</span>
              </button>
            );
          })}
        </div>
        <p className="field__hint">{t("Un clic scrive lo stile qui sotto: è un punto di partenza, correggilo finché somiglia a ciò che vuoi. Ctrl+Z torna a quello di prima.")}</p>
      </div>

      <div className="card">
        <p className="card__title">{t("come è disegnata l'opera")}</p>
        <div className="stack">
          <label className="field">
            <span className="field__label">{t("stile (vale per ogni immagine dell'opera)")}</span>
            <textarea
              rows={3}
              value={text}
              placeholder={STYLE_PRESETS[0]!.positive}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => run({ type: "project.style", positive: fragments(text) })}
            />
            <span className="field__hint">
              {t("Il segno, il colore, l'ombreggiatura, la texture: in inglese il modello lo legge meglio. Dillo in positivo («hand-drawn», «flat colours») invece di elencare ciò che non vuoi.")}</span>
          </label>
          {!chosen && (
            <p className="issue issue--warning">
              {t("Nessuno stile scelto: finché non lo scrivi vale «")}{t(STYLE_PRESETS.find((p) => p.id === style.preset)?.label ?? STYLE_PRESETS[0]!.label)}{t("», perché un'opera senza stile esce come un collage.")}</p>
          )}
          <label className="field">
            <span className="field__label">{t("da evitare")}</span>
            <input type="text" value={avoid} placeholder={t("lascialo vuoto, se puoi")} onChange={(e) => setAvoid(e.target.value)} onBlur={() => run({ type: "project.style", negative: fragments(avoid) })} />
            <span className="field__hint">{t("FLUX.2 non ha un prompt negativo: ciò che scrivi qui finisce nominato nel prompt, e a volte compare proprio per questo.")}</span>
          </label>
        </div>
      </div>

      <div className="card">
        <p className="card__title">{t("tavole di stile")}</p>
        <ReferenceImages
          store={store}
          references={style.references}
          onChange={(references) => run({ type: "project.style", references })}
          directory="style"
          useHint={t("Se allegarla a ogni generazione: il modello ne copia il segno, non il contenuto. Se ne allegano al massimo {0}.", MAX_STYLE_REFERENCES)}
        />
        {used > MAX_STYLE_REFERENCES && <p className="issue issue--info">{t("Ne sono spuntate")}{" "}{used}{t(": si allegano le prime")}{" "}{MAX_STYLE_REFERENCES}{t(", per lasciare posto a luoghi e personaggi.")}</p>}
        <p className="field__hint">
          {t("Un'immagine che ha già il segno giusto vale più di qualunque descrizione: si allega a ogni vignetta, scheda e tavola di luogo, e il modello ne copia linea, colore e ombre — non il soggetto. La più semplice da avere: genera una vignetta, e se ti convince tienila come tavola di stile dalla scheda Arte.")}</p>
      </div>
    </div>
  );
}
