import { useEffect, useRef, useState } from "react";
import type { PrefilledConfig } from "../devConfig.js";
import { useKeyNote } from "../platform/desktop.js";
import { local } from "../platform/localModels.js";
import type { LlmChoice } from "../runBreakdown.js";
import type { ImageConfig } from "./GenerateCard.js";
import { Tabs } from "./Tabs.js";

export type Configuration = Omit<PrefilledConfig, `${string}FromEnv`>;

interface Props {
  open: boolean;
  onClose: () => void;
  config: Configuration;
  onChange: (field: keyof Configuration, value: string) => void;
  service: LlmChoice["service"];
  onService: (service: LlmChoice["service"]) => void;
  imageService: ImageConfig["service"];
  onImageService: (service: ImageConfig["service"]) => void;
}

interface ConfigField {
  key: keyof Configuration;
  label: string;
  type?: "password" | "url";
}

const TEXT_GROUPS: readonly { label: string; fields: readonly ConfigField[] }[] = [
  { label: "Anthropic", fields: [{ key: "anthropicKey", label: "Chiave API", type: "password" }, { key: "anthropicModel", label: "Modello" }] },
  { label: "DeepSeek", fields: [{ key: "deepseekKey", label: "Chiave API", type: "password" }, { key: "deepseekModel", label: "Modello" }] },
  { label: "OpenAI", fields: [{ key: "openaiKey", label: "Chiave API", type: "password" }, { key: "openaiModel", label: "Modello" }, { key: "openaiBaseUrl", label: "URL base", type: "url" }] },
  { label: "Ollama", fields: [{ key: "ollamaHost", label: "Host", type: "url" }, { key: "ollamaModel", label: "Modello" }] },
];

const IMAGE_GROUPS: typeof TEXT_GROUPS = [
  { label: "Azure AI Foundry · FLUX", fields: [{ key: "azureFluxEndpoint", label: "Endpoint", type: "url" }, { key: "azureFluxKey", label: "Chiave API", type: "password" }, { key: "azureFluxDeployment", label: "Deployment" }] },
  { label: "Black Forest Labs · FLUX", fields: [{ key: "bflKey", label: "Chiave API", type: "password" }, { key: "bflModel", label: "Modello" }, { key: "bflBaseUrl", label: "URL base", type: "url" }] },
];

export function ConfigurationDialog({ open, onClose, config, onChange, service, onService, imageService, onImageService }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"text" | "image">("text");
  const keyNote = useKeyNote();

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="local-models configuration"
      aria-labelledby="configuration-title"
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="local-models__body">
        <h2 className="local-models__title">
          <span id="configuration-title">Configurazione</span>
          <button type="button" className="link-btn" onClick={onClose}>chiudi</button>
        </h2>
        <Tabs label="Configurazione servizi" value={tab} onChange={setTab} items={[{ id: "text", label: "Testo" }, { id: "image", label: "Immagini" }]} />
        <p className="field__hint">Chiavi API: {keyNote}</p>
        <div role="tabpanel" aria-label={tab === "text" ? "Testo" : "Immagini"}>
          <label className="field">
            <span className="field__label">Servizio attivo</span>
            {tab === "text" ? (
              <select value={service} onChange={(event) => onService(event.target.value as LlmChoice["service"])}>
                <option value="mock">Simulato</option>
                <option value="anthropic">Anthropic</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
                {local && <option value="local">Modello locale</option>}
              </select>
            ) : (
              <select value={imageService} onChange={(event) => onImageService(event.target.value as ImageConfig["service"])}>
                <option value="mock">Simulato</option>
                <option value="azure">Azure AI Foundry</option>
                <option value="flux">Black Forest Labs</option>
                <option value="local">Modello locale</option>
              </select>
            )}
          </label>
          {(tab === "text" ? TEXT_GROUPS : IMAGE_GROUPS).map((group) => (
            <fieldset className="configuration__group" key={group.label}>
              <legend>{group.label}</legend>
              <div className="configuration__fields">
                {group.fields.map((field) => (
                  <label className="field" key={field.key}>
                    <span className="field__label">{field.label}</span>
                    <input
                      type={field.type ?? "text"}
                      value={config[field.key]}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
    </dialog>
  );
}