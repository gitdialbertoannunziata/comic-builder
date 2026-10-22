import { useEffect, useRef } from "react";
import { t } from "../i18n.js";
import type { Area } from "./Workspace.js";

interface Props {
  open: boolean;
  mode: "welcome" | "guide";
  step: number;
  onExplore: () => void;
  onCreate: () => void;
  onClose: () => void;
  onStep: (step: number, area: Area) => void;
}

const GUIDE: Array<{ area: Area; title: string; description: string }> = [
  {
    area: "copione",
    title: "1 · Parti dal copione",
    description: "Il copione è il punto di partenza. Scrivilo o modificalo qui, poi premi «Spoglia» per ricavare scene, pagine e vignette.",
  },
  {
    area: "pagine",
    title: "2 · Costruisci le tavole",
    description: "In Pagine puoi modificare inquadrature e balloon, poi aggiungere l'arte. La generazione parte solo quando la chiedi: i servizi online possono comportare costi.",
  },
  {
    area: "personaggi",
    title: "3 · Dai coerenza alla storia",
    description: "In Riferimenti definisci stile, personaggi e luoghi. Quando le pagine sono pronte, controllale in Revisioni ed esportale nel formato che ti serve.",
  },
];

export function WelcomeDialog({ open, mode, step, onExplore, onCreate, onClose, onStep }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const current = GUIDE[step]!;
  const moveTo = (next: number) => onStep(next, GUIDE[next]!.area);

  return (
    <dialog ref={dialog} className="welcome" aria-labelledby="welcome-title" onClose={onClose}>
      <div className="welcome__body">
        <p className="welcome__eyebrow">{t("comic-builder · una guida rapida")}</p>
        <h2 id="welcome-title" className="welcome__title">
          {mode === "welcome" ? t("Dal copione alla tavola") : t(current.title)}
        </h2>
        {mode === "welcome" ? (
          <>
            <p className="welcome__description">
              {t("L'esempio del faro è già aperto. Esploralo passo per passo oppure inizia una storia nuova.")}
            </p>
            <div className="welcome__actions">
              <button type="button" className="btn btn--primary" onClick={onExplore}>
                {t("Esplora l'esempio")}
              </button>
              <button type="button" className="btn" onClick={onCreate}>
                {t("Crea un progetto vuoto")}
              </button>
            </div>
            <p className="welcome__note">
              {t("La guida non avvia generazioni né download. Puoi riaprirla dal menu Progetto.")}
            </p>
            <button type="button" className="link-btn" onClick={onClose}>
              {t("Più tardi")}
            </button>
          </>
        ) : (
          <>
            <p className="welcome__progress" aria-live="polite">
              {t("Passo {0} di {1}", step + 1, GUIDE.length)}
            </p>
            <p className="welcome__description">{t(current.description)}</p>
            <div className="welcome__actions">
              {step > 0 && (
                <button type="button" className="btn" onClick={() => moveTo(step - 1)}>
                  {t("Indietro")}
                </button>
              )}
              {step < GUIDE.length - 1 ? (
                <button type="button" className="btn btn--primary" onClick={() => moveTo(step + 1)}>
                  {t("Avanti")}
                </button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={onClose}>
                  {t("Inizia a lavorare")}
                </button>
              )}
              <button type="button" className="link-btn" onClick={onClose}>
                {t("Chiudi la guida")}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
