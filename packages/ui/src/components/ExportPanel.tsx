import { t } from "../i18n.js";
import { describeTarget, type ExportOutcome } from "../exportPages.js";
import { project } from "../project.js";
import { targetLabel } from "../labels.js";

interface Props {
  choices: ReadonlySet<string>;
  onChoicesChange: (choices: ReadonlySet<string>) => void;
  draft: boolean;
  onDraftChange: (draft: boolean) => void;
  destination: string | null;
  canChooseDestination: boolean;
  onChooseDestination: () => void;
  onExport: () => void;
  busy: boolean;
  progress: string | null;
  outcome: ExportOutcome | null;
  result: string | null;
  error: string | null;
  pageCount: number;
}

/** Soglia del gate di F2.1 (§12.2): slicing da ritoccare su meno del 20% delle pagine. */
const GATE_RATIO = 0.2;

const EXTRAS = [
  {
    key: "document",
    label: "documento",
    hint: "Il JSON rieditabile: griglia, balloon, camera come dati",
  },
  {
    key: "svg",
    label: "svg",
    hint: "Vettoriale della pagina canonica, col font incorporato",
  },
  {
    key: "pdf",
    label: "pdf",
    hint: "Un PDF multipagina del capitolo, dal formato principale",
  },
  {
    key: "prompts",
    label: "istruzioni",
    hint: "Brief e prompt per un modello di immagini esterno, pannello per pannello",
  },
] as const;

export function ExportPanel({
  choices,
  onChoicesChange,
  draft,
  onDraftChange,
  destination,
  canChooseDestination,
  onChooseDestination,
  onExport,
  busy,
  progress,
  outcome,
  result,
  error,
  pageCount,
}: Props) {
  function toggle(key: string) {
    const next = new Set(choices);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChoicesChange(next);
  }

  const errors = outcome?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = outcome?.issues.filter((i) => i.level === "warning") ?? [];

  return (
    <div className="stack">
      <div className="field">
        <span className="field__label">
          {t("formati — dal progetto, capitolo intero (")}{pageCount} {" "}{t("pag.)")}</span>
        <div className="targets">
          {project.targets.map((target) => {
            const key = `target:${target.id}`;
            return (
              <label key={key} className="target">
                <input
                  type="checkbox"
                  checked={choices.has(key)}
                  onChange={() => toggle(key)}
                />
                <span className="target__name" title={target.id}>
                  {targetLabel(target.id)}
                </span>
                <span className="target__spec">{describeTarget(target)}</span>
              </label>
            );
          })}
          {EXTRAS.map((extra) => (
            <label key={extra.key} className="target" title={t(extra.hint)}>
              <input
                type="checkbox"
                checked={choices.has(extra.key)}
                onChange={() => toggle(extra.key)}
              />
              <span className="target__name">{t(extra.label)}</span>
              <span className="target__spec">{t(extra.hint)}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="field field--row">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => onDraftChange(e.target.checked)}
        />
        <span>
          {t("includi la specifica di disegno")}<span className="field__hint">
            {" "}
            {t("— spenta, un pannello senza arte resta vuoto")}</span>
        </span>
      </label>

      <div className="field">
        <span className="field__label">{t("destinazione")}</span>
        {canChooseDestination ? (
          <>
            <button type="button" className="btn" onClick={onChooseDestination}>
              {destination
                ? t("cartella: {0}", destination)
                : t("Scegli una cartella…")}
            </button>
            <span className="field__hint">
              {destination
                ? t("Una sottocartella per formato.")
                : t("Senza cartella scelta, tutto finisce nei download in un unico .zip, una cartella per formato.")}
            </span>
          </>
        ) : (
          <span className="field__hint">
            {t("Questo browser non consente di scegliere una cartella: tutto finisce nei suoi download, in un unico .zip con una cartella per formato.")}</span>
        )}
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={onExport}
        disabled={busy || choices.size === 0}
      >
        {busy ? (progress ?? "Esporto…") : "Esporta"}
      </button>

      {error && <p className="issue issue--error script__result">{error}</p>}
      {result && !error && <p className="muted script__result">{result}</p>}

      {outcome && (
        <ul className="export-report">
          {outcome.summaries.map((s) => {
            const report = s.slicePlan?.report;
            return (
              <li key={s.targetId}>
                <strong>{t(s.label)}</strong> — {s.files} file
                {s.slicePlan && report && (
                  <div className="export-report__slice">
                    {s.slicePlan.slices.length} slice
                    {report.shortSlices > 0
                      ? t(" ({0} corte)", report.shortSlices)
                      : ""}{" "}
                    ·{" "}
                    {s.slicePlan.cuts.filter((c) => c.kind === "gutter").length}{" "}
                    {t("di")}{" "}{s.slicePlan.cuts.length} {" "}{t("tagli nei gutter · pagine da controllare")}{" "}{report.pagesToCheck.length}/{report.pages} (
                    {Math.round(report.checkRatio * 100)}%){" "}
                    <span
                      className={
                        report.checkRatio < GATE_RATIO
                          ? "gate gate--ok"
                          : "gate gate--ko"
                      }
                    >
                      {report.checkRatio < GATE_RATIO
                        ? t("gate F2.1 superato")
                        : t("sopra il 20%: gate F2.1 non superato")}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          {[...errors, ...warnings].map((i, n) => (
            <li key={n} className={`issue issue--${i.level}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
