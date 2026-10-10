import { t } from "../i18n.js";
import { useSyncExternalStore } from "react";
import { generationScheduler, type GenerationLane } from "../generationScheduler.js";

const LANES: Readonly<Record<GenerationLane, string>> = { local: "Locale", "online-text": "Online testo", "online-image": "Online immagini" };

export function GenerationQueues() {
  const jobs = useSyncExternalStore(generationScheduler.subscribe, generationScheduler.getSnapshot, generationScheduler.getSnapshot);
  if (jobs.length === 0) return null;
  return (
    <details className="generation-queues">
      <summary>{t("Lavori:")}{" "}{jobs.filter((job) => job.state === "running").length} {" "}{t("in esecuzione,")}{" "}{jobs.filter((job) => job.state === "queued").length} {" "}{t("in coda")}</summary>
      <ul className="generation-queues__list" aria-live="polite">
        {jobs.map((job) => (
          <li key={job.id}>
            <span><strong>{t(LANES[job.lane])}</strong> · {job.label} · {job.state === "running" ? t("In esecuzione") : t("In coda · posizione {0}", jobs.filter((other) => other.lane === job.lane && other.state === "queued" && other.id <= job.id).length)}</span>
            {job.state === "queued" && <button type="button" className="link-btn" title={t("Rimuovi il lavoro in attesa")} onClick={() => generationScheduler.cancel(job.id)}>{t("Annulla")}</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}