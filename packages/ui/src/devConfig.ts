/**
 * Configurazione comoda per lo sviluppo, letta dall'ambiente.
 *
 * Vite **incorpora** le variabili `VITE_*` nel bundle: in un build di
 * produzione la chiave finirebbe dentro il JavaScript servito a chiunque.
 * Per questo si legge solo in modalità sviluppo — il controllo su
 * `import.meta.env.DEV` non è prudenza eccessiva, è ciò che impedisce che
 * `vite build` porti la chiave fuori di qui.
 *
 * Il posto giusto dove vivrà davvero è l'archivio sicuro dell'host, via
 * PlatformService, quando questo sarà impacchettato come applicazione
 * desktop (§14.4).
 */

interface DevEnv {
  VITE_ANTHROPIC_API_KEY?: string;
  VITE_ANTHROPIC_MODEL?: string;
  VITE_OLLAMA_HOST?: string;
  VITE_OLLAMA_MODEL?: string;
  VITE_DEEPSEEK_API_KEY?: string;
  VITE_DEEPSEEK_MODEL?: string;
  VITE_OPENAI_API_KEY?: string;
  VITE_OPENAI_MODEL?: string;
  VITE_OPENAI_BASE_URL?: string;
  VITE_BFL_API_KEY?: string;
  VITE_BFL_MODEL?: string;
  VITE_BFL_BASE_URL?: string;
  VITE_AZURE_FLUX_ENDPOINT?: string;
  VITE_AZURE_FLUX_API_KEY?: string;
  VITE_AZURE_FLUX_DEPLOYMENT?: string;
}

function devEnv(): DevEnv {
  return import.meta.env.DEV ? (import.meta.env as unknown as DevEnv) : {};
}

export interface PrefilledConfig {
  anthropicKey: string;
  anthropicModel: string;
  ollamaHost: string;
  ollamaModel: string;
  /** Vero se la chiave arriva dall'ambiente: la UI lo dice, invece di mostrare un campo pieno senza spiegazione. */
  anthropicKeyFromEnv: boolean;
  deepseekKey: string;
  deepseekModel: string;
  deepseekKeyFromEnv: boolean;
  openaiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  openaiKeyFromEnv: boolean;
  bflKey: string;
  bflModel: string;
  bflBaseUrl: string;
  bflKeyFromEnv: boolean;
  azureFluxEndpoint: string;
  azureFluxKey: string;
  azureFluxDeployment: string;
  azureFluxKeyFromEnv: boolean;
}

export function prefilledConfig(): PrefilledConfig {
  const env = devEnv();
  const key = env.VITE_ANTHROPIC_API_KEY?.trim() ?? "";
  const deepseekKey = env.VITE_DEEPSEEK_API_KEY?.trim() ?? "";
  const openaiKey = env.VITE_OPENAI_API_KEY?.trim() ?? "";
  const bflKey = env.VITE_BFL_API_KEY?.trim() ?? "";
  const azureFluxKey = env.VITE_AZURE_FLUX_API_KEY?.trim() ?? "";

  return {
    anthropicKey: key,
    anthropicModel: env.VITE_ANTHROPIC_MODEL?.trim() || "claude-opus-5",
    ollamaHost: env.VITE_OLLAMA_HOST?.trim() || "http://localhost:11434",
    ollamaModel: env.VITE_OLLAMA_MODEL?.trim() || "mistral",
    anthropicKeyFromEnv: key.length > 0,
    deepseekKey,
    deepseekModel: env.VITE_DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    deepseekKeyFromEnv: deepseekKey.length > 0,
    openaiKey,
    openaiModel: env.VITE_OPENAI_MODEL?.trim() || "gpt-6-astra",
    openaiBaseUrl: env.VITE_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    openaiKeyFromEnv: openaiKey.length > 0,
    bflKey,
    bflModel: env.VITE_BFL_MODEL?.trim() || "flux-2-pro",
    bflBaseUrl: env.VITE_BFL_BASE_URL?.trim() || "https://api.bfl.ai",
    bflKeyFromEnv: bflKey.length > 0,
    azureFluxEndpoint: env.VITE_AZURE_FLUX_ENDPOINT?.trim() ?? "",
    azureFluxKey,
    azureFluxDeployment: env.VITE_AZURE_FLUX_DEPLOYMENT?.trim() || "FLUX.2-pro",
    azureFluxKeyFromEnv: azureFluxKey.length > 0,
  };
}
