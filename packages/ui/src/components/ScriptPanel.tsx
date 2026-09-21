import { useState } from "react";
import type { ValidationIssue } from "@comic-builder/core";

export type ServiceChoice = "mock" | "ollama" | "anthropic" | "deepseek";

export interface BreakdownSummary {
  scenes: number;
  beats: number;
  pages: number;
  service: string;
  model: string;
  durationMs: number;
  issues: ValidationIssue[];
}

interface Props {
  script: string;
  onScriptChange: (script: string) => void;
  service: ServiceChoice;
  onServiceChange: (service: ServiceChoice) => void;
  ollamaModel: string;
  onOllamaModelChange: (model: string) => void;
  ollamaHost: string;
  onOllamaHostChange: (host: string) => void;
  anthropicKey: string;
  onAnthropicKeyChange: (key: string) => void;
  anthropicModel: string;
  onAnthropicModelChange: (model: string) => void;
  anthropicKeyFromEnv: boolean;
  deepseekKey: string;
  onDeepseekKeyChange: (key: string) => void;
  deepseekModel: string;
  onDeepseekModelChange: (model: string) => void;
  deepseekKeyFromEnv: boolean;
  onRun: () => void;
  running: boolean;
  error: string | null;
  summary: BreakdownSummary | null;
}

/**
 * Da qui entra il capitolo. Finora la catena dello spoglio esisteva solo da
 * codice: senza un posto dove incollare il testo, F1 non era raggiungibile da
 * chi usa lo strumento.
 */
export function ScriptPanel({
  script,
  onScriptChange,
  service,
  onServiceChange,
  ollamaModel,
  onOllamaModelChange,
  ollamaHost,
  onOllamaHostChange,
  anthropicKey,
  onAnthropicKeyChange,
  anthropicModel,
  onAnthropicModelChange,
  anthropicKeyFromEnv,
  deepseekKey,
  onDeepseekKeyChange,
  deepseekModel,
  onDeepseekModelChange,
  deepseekKeyFromEnv,
  onRun,
  running,
  error,
  summary,
}: Props) {
  const [open, setOpen] = useState(true);

  return (
    <section className="script">
      <button type="button" className="script__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="eyebrow" style={{ margin: 0 }}>
          Copione
        </span>
        <span className="muted">{open ? "nascondi" : "mostra"}</span>
      </button>

      {open && (
        <div className="script__body">
          <label className="field">
            <span className="field__label">capitolo</span>
            <textarea
              className="script__text"
              value={script}
              rows={12}
              spellCheck={false}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder={"# Titolo della scena\n\nDescrizione di cosa si vede.\n\nNOME: Una battuta."}
            />
            <span className="field__hint">
              Titoli markdown o righe <code>INT./EST.</code> dividono le scene; i paragrafi diventano beat; le
              battute si scrivono <code>NOME: testo</code>.
            </span>
          </label>

          <div className="field">
            <span className="field__label">spoglio</span>
            <div className="segmented">
              <button
                type="button"
                className="seg"
                aria-pressed={service === "mock"}
                onClick={() => onServiceChange("mock")}
                title="Euristica deterministica, nessun modello: è il livello di riferimento da battere"
              >
                euristico
              </button>
              <button
                type="button"
                className="seg"
                aria-pressed={service === "ollama"}
                onClick={() => onServiceChange("ollama")}
                title="Modello locale via Ollama: il copione non esce dalla macchina"
              >
                ollama
              </button>
              <button
                type="button"
                className="seg"
                aria-pressed={service === "anthropic"}
                onClick={() => onServiceChange("anthropic")}
                title="API di Anthropic: il modello più capace, ma il copione esce verso terzi"
              >
                claude
              </button>
              <button
                type="button"
                className="seg"
                aria-pressed={service === "deepseek"}
                onClick={() => onServiceChange("deepseek")}
                title="API di DeepSeek: JSON garantito ma non lo schema — lo controlla la validazione a valle"
              >
                deepseek
              </button>
            </div>
          </div>

          {service === "ollama" && (
            <>
              <label className="field">
                <span className="field__label">modello</span>
                <input
                  type="text"
                  value={ollamaModel}
                  onChange={(e) => onOllamaModelChange(e.target.value)}
                  placeholder="mistral"
                />
              </label>
              <label className="field">
                <span className="field__label">host</span>
                <input
                  type="text"
                  value={ollamaHost}
                  onChange={(e) => onOllamaHostChange(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <span className="field__hint">
                  La richiesta parte dal <strong>browser</strong>, non dal server che serve questa pagina: vale
                  quindi il <code>localhost</code> della tua macchina. Se Ollama rifiuta, riavvialo con{" "}
                  <code>OLLAMA_ORIGINS=*</code>.
                </span>
              </label>
            </>
          )}

          {service === "anthropic" && (
            <>
              <label className="field">
                <span className="field__label">chiave API</span>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => onAnthropicKeyChange(e.target.value)}
                  placeholder="sk-ant-..."
                />
                <span className="field__hint">
                  {anthropicKeyFromEnv
                    ? "Letta da .env.local (solo in sviluppo). "
                    : "Resta in questa scheda e non viene salvata. "}
                  <strong>Il copione esce verso terzi</strong>: per una serie inedita, valuta se è quello che
                  vuoi — lo spoglio locale non lo fa.
                </span>
              </label>
              <label className="field">
                <span className="field__label">modello</span>
                <input
                  type="text"
                  value={anthropicModel}
                  onChange={(e) => onAnthropicModelChange(e.target.value)}
                  placeholder="claude-opus-5"
                />
              </label>
            </>
          )}

          {service === "deepseek" && (
            <>
              <label className="field">
                <span className="field__label">chiave API</span>
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={(e) => onDeepseekKeyChange(e.target.value)}
                  placeholder="sk-..."
                />
                <span className="field__hint">
                  {deepseekKeyFromEnv
                    ? "Letta da .env.local (solo in sviluppo). "
                    : "Resta in questa scheda e non viene salvata. "}
                  <strong>Il copione esce verso terzi.</strong> DeepSeek garantisce JSON valido ma non la forma
                  richiesta: gli scostamenti li intercetta la validazione, e compaiono qui sotto.
                </span>
              </label>
              <label className="field">
                <span className="field__label">modello</span>
                <input
                  type="text"
                  value={deepseekModel}
                  onChange={(e) => onDeepseekModelChange(e.target.value)}
                  placeholder="deepseek-flash"
                />
              </label>
            </>
          )}

          <button type="button" className="btn btn--primary" onClick={onRun} disabled={running}>
            {running ? "Spoglio in corso…" : "Spoglia il capitolo"}
          </button>

          {error && <p className="issue issue--error script__result">{error}</p>}

          {summary && !error && (
            <div className="script__result">
              <p className="muted" style={{ margin: 0 }}>
                {summary.scenes} scene · {summary.beats} beat · {summary.pages} pagine — {summary.service}/
                {summary.model}, {summary.durationMs}ms
              </p>
              {summary.issues.length > 0 && (
                <ul className="issues" style={{ marginTop: 8 }}>
                  {summary.issues.map((issue, i) => (
                    <li key={i}>
                      <div className={`issue issue--${issue.level}`}>
                        <span className="issue__code">{issue.code}</span>
                        <span className="issue__text">{issue.message}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
