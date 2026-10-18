import { t } from "./i18n.js";
import { FLUX2_KLEIN_4B, FLUX2_PRO, maxReferencesFor } from "@comic-builder/core";
import {
  AzureFluxImageService,
  azureFluxModel,
  ComfyUiImageService,
  comfyModelName,
  comfyReferenceSlots,
  parseComfyWorkflow,
  FluxImageService,
  LocalSdImageService,
  MockImageService,
  type ImageService,
} from "@comic-builder/image";
import { desktop, networkFetch } from "./platform/desktop.js";
import { local } from "./platform/localModels.js";

/*
 * La configurazione delle immagini e i servizi che ne nascono. Sta fuori dai
 * componenti perché la usano in tanti (la scheda Arte, i personaggi, i luoghi,
 * la preparazione dei riferimenti) e perché non è interfaccia: è la scelta di
 * chi chiamare, e come.
 */

/** Come si genera: scelto una volta per la sessione, vale per tutti i capitoli. */
export interface ImageConfig {
  service: "azure" | "flux" | "local" | "comfyui" | "mock";
  onService: (service: ImageConfig["service"]) => void;
  apiKey: string;
  onApiKey: (key: string) => void;
  keyFromEnv: boolean;
  model: string;
  onModel: (model: string) => void;
  baseUrl: string;
  /** FLUX.2 distribuito su Azure AI Foundry: endpoint della risorsa, sua chiave, nome del deployment (da cui si riconosce il modello). */
  azureKey: string;
  onAzureKey: (key: string) => void;
  azureKeyFromEnv: boolean;
  azureEndpoint: string;
  onAzureEndpoint: (endpoint: string) => void;
  azureDeployment: string;
  onAzureDeployment: (deployment: string) => void;
  megapixels: number;
  onMegapixels: (megapixels: number) => void;
  /** Il motore locale: dove ascolta sd-server di stable-diffusion.cpp (nel browser, avviato a mano). */
  localUrl: string;
  onLocalUrl: (url: string) => void;
  /** Nell'app desktop il motore locale lo installa e lo avvia l'app: niente indirizzo da scrivere. */
  localManaged: boolean;
  /** Il modello delle immagini installato dalla procedura guidata; null se manca. */
  localModel: string | null;
  /** ComfyUI dell'autore: dove ascolta, e il flusso in formato API coi segnaposto (vuoto: quello di partenza). */
  comfyUrl: string;
  onComfyUrl: (url: string) => void;
  comfyWorkflow: string;
  onComfyWorkflow: (workflow: string) => void;
}

type ComfyWorkflowState = { model: string; slots: number; error: null } | { model: string; slots: 0; error: string };
/** Il flusso ComfyUI letto una volta per testo: lo si chiede a ogni render, e l'impronta costa. */
let comfyCache: { text: string; state: ComfyWorkflowState } | null = null;

export function comfyWorkflowState(text: string): ComfyWorkflowState {
  if (comfyCache?.text === text) return comfyCache.state;
  let state: ComfyWorkflowState;
  try {
    const workflow = parseComfyWorkflow(text);
    state = { model: comfyModelName(workflow), slots: comfyReferenceSlots(workflow).length, error: null };
  } catch (cause) {
    state = { model: "comfyui:?", slots: 0, error: cause instanceof Error ? cause.message : String(cause) };
  }
  comfyCache = { text, state };
  return state;
}

/** Se il servizio gira sulla GPU di questa macchina: una vignetta alla volta, nessuna spesa, la coda locale. */
export function onThisMachine(config: Pick<ImageConfig, "service">): boolean {
  return config.service === "local" || config.service === "comfyui";
}

/** Quante immagini di riferimento si allegano: le dice il modello o, con ComfyUI, i posti del flusso. */
export function specMaxReferences(config: ImageConfig): number {
  return config.service === "comfyui" ? comfyWorkflowState(config.comfyWorkflow).slots : maxReferencesFor(specModel(config));
}

/** Come si chiama il lavoro nella barra delle code. */
export function jobModel(config: ImageConfig): string {
  if (config.service === "local") return config.localModel ?? t("locale");
  if (config.service === "comfyui") return `ComfyUI · ${specModel(config).slice("comfyui:".length)}`;
  return specModel(config);
}

/**
 * Il modello che finisce nello spec: col servizio finto non si registra un
 * render come se fosse di FLUX. Su Azure è il modello, non il nome del
 * deployment: lo stesso spec vale da qualunque fornitore arrivi l'immagine.
 */
export function specModel(config: ImageConfig): string {
  if (config.service === "mock") return "mock-image";
  if (config.service === "local") return FLUX2_KLEIN_4B;
  // Con ComfyUI il modello è il flusso: i file che carica e un'impronta del grafo.
  if (config.service === "comfyui") return comfyWorkflowState(config.comfyWorkflow).model;
  return config.service === "azure" ? azureFluxModel(config.azureDeployment) : config.model.trim() || FLUX2_PRO;
}

// Nessuno dei due fornitori abilita CORS: nel browser si passa dal server di sviluppo (vite.config.ts);
// nell'app desktop le chiamate le fa il processo principale, e il proxy non serve.
const viaProxy = desktop ? {} : { rewriteUrl: (url: string) => `/image-proxy/${url.replace(/^https:\/\//, "")}` };
// Il motore locale nemmeno, per quanto se ne sa: stesso server di sviluppo, solo verso questa macchina.
const viaLocalProxy = desktop ? {} : { rewriteUrl: (url: string) => `/local-image/${url.replace(/^http:\/\//, "")}` };

export function localService(config: ImageConfig): LocalSdImageService {
  // Nell'app desktop l'indirizzo lo dà il motore quando parte (e ferma quello dello spoglio): lo si chiede alla prima richiesta.
  // Il log del motore va con la richiesta: se un lavoro fallisce, «generate_image returned no results» senza le sue righe non dice niente.
  if (config.localManaged && local) {
    return new LocalSdImageService({ resolveBaseUrl: () => local!.start("image"), engineLog: () => local!.log("image"), model: specModel(config), ...networkFetch });
  }
  return new LocalSdImageService({ baseUrl: config.localUrl, model: specModel(config), ...viaLocalProxy, ...networkFetch });
}

export function comfyService(config: ImageConfig): ComfyUiImageService {
  return new ComfyUiImageService({ baseUrl: config.comfyUrl, workflow: config.comfyWorkflow, ...viaLocalProxy, ...networkFetch });
}

export function makeService(config: ImageConfig): ImageService {
  if (config.service === "mock") return new MockImageService();
  if (config.service === "local") return localService(config);
  if (config.service === "comfyui") return comfyService(config);
  if (config.service === "azure") {
    return new AzureFluxImageService({ apiKey: config.azureKey, endpoint: config.azureEndpoint, deployment: config.azureDeployment, ...viaProxy, ...networkFetch });
  }
  return new FluxImageService({
    apiKey: config.apiKey,
    model: specModel(config),
    baseUrl: config.baseUrl,
    ...viaProxy,
    ...networkFetch,
  });
}

/** I motori su questa macchina (ComfyUI, sd-server): in chiaro solo verso sé stessi. */
const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/;

/** Se c'è quanto serve per chiamare il servizio scelto. */
export function serviceReady(config: ImageConfig): boolean {
  if (config.service === "mock") return true;
  if (config.service === "comfyui") return LOOPBACK_URL.test(config.comfyUrl.trim()) && comfyWorkflowState(config.comfyWorkflow).error === null;
  if (config.service === "local") return config.localManaged ? config.localModel !== null : LOOPBACK_URL.test(config.localUrl.trim());
  return config.service === "azure" ? config.azureKey.trim().length > 0 && config.azureEndpoint.trim().length > 0 : config.apiKey.trim().length > 0;
}

