import { t } from "../i18n.js";
import { useEffect, useRef } from "react";
import { keyCaps, useLegendGroups } from "../keyboard.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * La legenda delle scorciatoie: si apre con `?` e mostra ciò che le aree
 * hanno dichiarato (`useShortcuts`), non un elenco scritto a parte. È un
 * `<dialog>` modale: Esc lo chiude e il focus torna dov'era.
 */
export function ShortcutsHelp({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const groups = useLegendGroups();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="shortcuts"
      aria-label={t("Scorciatoie da tastiera")}
      onClose={onClose}
      // Un clic sullo sfondo (fuori dal contenuto) chiude, come Esc.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "?" && onClose()}
    >
      <div className="shortcuts__body">
        <p className="shortcuts__title">
          <span>{t("Scorciatoie da tastiera")}</span>
          <button type="button" className="link-btn" onClick={onClose}>
            {t("chiudi")}</button>
        </p>
        <p className="field__hint">
          {t("Mentre scrivi in un campo le lettere sono testo:")}{" "}<kbd>Esc</kbd> {" "}{t("esce dal campo, e da lì i tasti sono comandi.")}</p>
        <div className="shortcuts__groups">
          {groups.map((group) => (
            <section key={group.title} className="shortcuts__group">
              <h3>{t(group.title)}</h3>
              <dl>
                {group.shortcuts
                  .filter((s) => s.label)
                  .map((s) => (
                    <div key={s.keys.join(" ")} className="shortcuts__row">
                      <dt>
                        {s.shown ? (
                          <kbd>{s.shown}</kbd>
                        ) : (
                          s.keys.map((keys, i) => (
                            <span key={keys} className="shortcuts__combo">
                              {i > 0 && <span className="shortcuts__or">/</span>}
                              {keyCaps(keys).map((cap) => (
                                <kbd key={cap}>{cap}</kbd>
                              ))}
                            </span>
                          ))
                        )}
                      </dt>
                      <dd>{s.label === undefined ? null : t(s.label)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
