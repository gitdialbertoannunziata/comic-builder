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
}

export function prefilledConfig(): PrefilledConfig {
  const env = devEnv();
  const key = env.VITE_ANTHROPIC_API_KEY?.trim() ?? "";

  return {
    anthropicKey: key,
    anthropicModel: env.VITE_ANTHROPIC_MODEL?.trim() || "claude-opus-5",
    ollamaHost: env.VITE_OLLAMA_HOST?.trim() || "http://localhost:11434",
    ollamaModel: env.VITE_OLLAMA_MODEL?.trim() || "mistral",
    anthropicKeyFromEnv: key.length > 0,
  };
}
