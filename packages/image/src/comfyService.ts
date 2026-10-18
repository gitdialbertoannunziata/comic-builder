import { canonicalJson, sha1Hex, type RenderSpec } from "@comic-builder/core";
import {
  ImageCancelledError,
  ImageError,
  followUp,
  readBody,
  requestSignal,
  settled,
  type ImageEstimate,
  type ImageRequest,
  type ImageResult,
  type ImageService,
  type ReferenceImage,
} from "./service.js";
import { sha256Hex } from "./bytes.js";

/**
 * `ImageService` su ComfyUI: il server che l'autore ha già sulla sua
 * macchina, coi suoi modelli, i suoi nodi e i suoi flussi.
 *
 * Il flusso è dell'autore: un grafo esportato da ComfyUI con «Save (API)»,
 * in cui i valori che vengono dallo spec sono segnaposto — `{{prompt}}`,
 * `{{seed}}`, `{{width}}`, `{{height}}` e `{{image_1}}` … `{{image_N}}` per
 * le immagini di riferimento, nell'ordine in cui il prompt le nomina. Senza
 * un flusso suo vale quello di partenza: FLUX.2 [klein] 4B coi file che il
 * modello ufficiale di ComfyUI scarica, e quattro riferimenti.
 *
 * Una vignetta che ha meno riferimenti dei posti del flusso non lascia
 * immagini vuote al modello: i nodi che dipendono da un posto vuoto si
 * tolgono, e chi ne leggeva il condizionamento lo prende dal nodo prima
 * (`ReferenceLatent` in catena: con due riferimenti restano i primi due).
 *
 * Si parla con l'API HTTP di ComfyUI: le immagini si caricano in `input/`,
 * il grafo si accoda con `/prompt`, lo storico dice quando è finito, `/view`
 * dà i byte. Fermare la coda toglie il lavoro dalla coda di ComfyUI, o lo
 * interrompe se è già in corso: la GPU non calcola immagini che nessuno aspetta.
 */
export interface ComfyUiOptions {
  /** Dove ascolta ComfyUI: di norma `http://127.0.0.1:8188`. */
  baseUrl?: string;
  /** Il grafo in formato API, coi segnaposto; vuoto, vale `DEFAULT_COMFY_WORKFLOW`. */
  workflow?: string;
  fetchImpl?: typeof fetch;
  /** Trasforma ogni URL prima della chiamata: dal browser in sviluppo si passa dal proxy di Vite. */
  rewriteUrl?: (url: string) => string;
  pollMs?: number;
  /** Il primo caricamento di un modello grande, su una GPU lenta, prende minuti. */
  timeoutMs?: number;
  /** Il tempo massimo di una singola chiamata, risposta compresa. */
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const COMFY_DEFAULT_URL = "http://127.0.0.1:8188";
/** Il prefisso del modello registrato negli spec generati con ComfyUI. */
export const COMFY_MODEL_PREFIX = "comfyui:";

type Link = [string, number];
interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ComfyWorkflow = Record<string, ComfyNode>;

const REFERENCE_NODES = (slots: number) => {
  const nodes: ComfyWorkflow = {};
  let conditioning: Link = ["4", 0];
  for (let i = 1; i <= slots; i++) {
    nodes[`2${i}0`] = { class_type: "LoadImage", inputs: { image: `{{image_${i}}}` }, _meta: { title: `Riferimento ${i}` } };
    nodes[`2${i}1`] = { class_type: "VAEEncode", inputs: { pixels: [`2${i}0`, 0], vae: ["3", 0] } };
    nodes[`2${i}2`] = { class_type: "ReferenceLatent", inputs: { conditioning, latent: [`2${i}1`, 0] } };
    conditioning = [`2${i}2`, 0];
  }
  return { nodes, conditioning };
};

/**
 * Il flusso di partenza: FLUX.2 [klein] 4B, la stessa ricetta del motore
 * locale (4 passi, guida 1, euler), coi nomi dei file del modello ufficiale
 * di ComfyUI. Chi ha altri file, o un altro modello, incolla il suo.
 */
export const DEFAULT_COMFY_WORKFLOW: string = (() => {
  const references = REFERENCE_NODES(4);
  const workflow: ComfyWorkflow = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "flux2", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "flux2-vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["2", 0] } },
    ...references.nodes,
    "5": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: references.conditioning } },
    "6": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "7": { class_type: "Flux2Scheduler", inputs: { steps: 4, width: "{{width}}", height: "{{height}}" } },
    "8": { class_type: "EmptyFlux2LatentImage", inputs: { width: "{{width}}", height: "{{height}}", batch_size: 1 } },
    "9": { class_type: "RandomNoise", inputs: { noise_seed: "{{seed}}" } },
    "10": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["9", 0], guider: ["5", 0], sampler: ["6", 0], sigmas: ["7", 0], latent_image: ["8", 0] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] } },
    "12": { class_type: "SaveImage", inputs: { images: ["11", 0], filename_prefix: "comic-builder" } },
  };
  return JSON.stringify(workflow, null, 2);
})();

const NUMERIC = new Set(["seed", "width", "height"]);
const TOKEN = /\{\{\s*(prompt|seed|width|height|image_(\d+))\s*\}\}/g;
const HAS_TOKEN = /\{\{\s*(prompt|seed|width|height|image_\d+)\s*\}\}/;
const isLink = (value: unknown): value is Link => Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";

/** Il grafo, letto e controllato: un errore qui si dice prima di accodare, e in parole dell'autore. */
export function parseComfyWorkflow(text: string | undefined): ComfyWorkflow {
  const source = text?.trim() ? text : DEFAULT_COMFY_WORKFLOW;
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw new ImageError(`Il flusso ComfyUI non è JSON valido: ${cause instanceof Error ? cause.message : String(cause)}`, "comfyui", false, cause);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ImageError("Il flusso ComfyUI dev'essere un oggetto JSON.", "comfyui");
  if ("nodes" in parsed && "links" in parsed) {
    throw new ImageError("Questo è il flusso nel formato dell'editor: in ComfyUI esportalo con «Workflow → Export (API)» (o «Save (API)»).", "comfyui");
  }
  const workflow = parsed as Record<string, unknown>;
  for (const [id, node] of Object.entries(workflow)) {
    if (!node || typeof node !== "object" || typeof (node as ComfyNode).class_type !== "string" || typeof (node as ComfyNode).inputs !== "object") {
      throw new ImageError(`Il nodo «${id}» del flusso ComfyUI non ha class_type e inputs: serve l'esportazione in formato API.`, "comfyui");
    }
  }
  const slots = comfyReferenceSlots(workflow as ComfyWorkflow);
  slots.forEach((slot, i) => {
    if (slot !== i + 1) throw new ImageError(`I segnaposto delle immagini vanno numerati da 1 senza buchi: manca {{image_${i + 1}}}.`, "comfyui");
  });
  if (!JSON.stringify(workflow).match(/\{\{\s*prompt\s*\}\}/)) throw new ImageError("Il flusso ComfyUI non contiene {{prompt}}: il testo della vignetta non arriverebbe al modello.", "comfyui");
  return workflow as ComfyWorkflow;
}

/** I posti per le immagini di riferimento, in ordine: `{{image_1}}`, `{{image_2}}`… */
export function comfyReferenceSlots(workflow: ComfyWorkflow): number[] {
  const found = new Set<number>();
  for (const match of JSON.stringify(workflow).matchAll(TOKEN)) if (match[2]) found.add(Number(match[2]));
  return [...found].sort((a, b) => a - b);
}

/**
 * Il modello che lo spec registra: i file di modello del grafo e un'impronta
 * del grafo stesso. Un flusso cambiato è un altro modo di disegnare, e le
 * vignette fatte col vecchio risultano da rigenerare — come cambiando fornitore.
 */
export function comfyModelName(workflow: ComfyWorkflow): string {
  const files = Object.values(workflow)
    .flatMap((node) => Object.entries(node.inputs))
    .filter(([key, value]) => /(unet|ckpt|model)_name$/.test(key) && typeof value === "string")
    .map(([, value]) => String(value).replace(/^.*[\\/]/, "").replace(/\.(safetensors|gguf|ckpt|pt|pth|bin)$/i, ""));
  return `${COMFY_MODEL_PREFIX}${files[0] ?? "workflow"}@${sha1Hex(canonicalJson(workflow)).slice(0, 8)}`;
}

/**
 * Il grafo da accodare: segnaposto riempiti, e tolti i nodi che dipendono da
 * un posto di riferimento rimasto vuoto. Chi leggeva da un nodo tolto prende,
 * se c'è, l'ingresso omonimo di quel nodo (il condizionamento che passa per
 * una catena di `ReferenceLatent`); altrimenti si toglie anche lui.
 */
export function fillComfyWorkflow(workflow: ComfyWorkflow, values: { prompt: string; seed: number; width: number; height: number; images: readonly string[] }): ComfyWorkflow {
  const graph: ComfyWorkflow = JSON.parse(JSON.stringify(workflow));
  const removed = new Set<string>();

  const fill = (value: unknown): { value: unknown; missing: boolean } => {
    if (typeof value === "string") {
      let missing = false;
      const whole = value.match(/^\{\{\s*(seed|width|height)\s*\}\}$/);
      if (whole && NUMERIC.has(whole[1]!)) return { value: values[whole[1] as "seed" | "width" | "height"], missing };
      const text = value.replace(TOKEN, (_, name: string, slot: string | undefined) => {
        if (slot) {
          const image = values.images[Number(slot) - 1];
          if (image === undefined) missing = true;
          return image ?? "";
        }
        return name === "prompt" ? values.prompt : String(values[name as "seed" | "width" | "height"]);
      });
      return { value: text, missing };
    }
    if (Array.isArray(value) && !isLink(value)) {
      const items = value.map(fill);
      return { value: items.map((i) => i.value), missing: items.some((i) => i.missing) };
    }
    return { value, missing: false };
  };

  for (const [id, node] of Object.entries(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      const filled = fill(value);
      node.inputs[key] = filled.value;
      if (filled.missing) removed.add(id);
    }
  }

  // Si propaga finché qualcosa cambia: un nodo tolto può far cadere chi lo seguiva.
  const resolve = (link: Link, key: string, seen = new Set<string>()): Link | null => {
    if (!removed.has(link[0])) return link;
    if (seen.has(link[0])) return null;
    seen.add(link[0]);
    const through = graph[link[0]]?.inputs[key];
    return isLink(through) ? resolve(through, key, seen) : null;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, node] of Object.entries(graph)) {
      if (removed.has(id)) continue;
      for (const [key, value] of Object.entries(node.inputs)) {
        if (!isLink(value) || !removed.has(value[0])) continue;
        const next = resolve(value, key);
        if (next) node.inputs[key] = next;
        else {
          removed.add(id);
          changed = true;
          break;
        }
      }
    }
  }
  for (const id of removed) delete graph[id];
  if (!Object.values(graph).some((node) => /^(SaveImage|PreviewImage)$/.test(node.class_type) || /save.*image/i.test(node.class_type))) {
    throw new ImageError("Nel flusso ComfyUI non resta un nodo che salvi l'immagine (SaveImage): se dipende da un'immagine di riferimento, rendila facoltativa.", "comfyui");
  }
  return graph;
}

interface HistoryEntry {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
  status?: { status_str?: string; completed?: boolean; messages?: Array<[string, Record<string, unknown>]> };
}

export interface ComfyEngineInfo {
  version: string;
  device: string;
  /** I nodi del flusso che questo ComfyUI non conosce: un pacchetto di nodi da installare. */
  missingNodes: string[];
  /** I valori a scelta che questo ComfyUI non ha: di solito file di modello da scaricare. */
  missingValues: Array<{ node: string; input: string; value: string }>;
}

const EXTENSION: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Il corpo `multipart/form-data` a mano: la `fetch` dell'app desktop accetta byte, non `FormData`. */
function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Uint8Array }): { body: Uint8Array; type: string } {
  const boundary = `----comic-builder-${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, encoder.encode(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

/** Gli errori di convalida di `/prompt`, detti per nodo: «UNETLoader: Value not in list (unet_name: …)». */
function describeRejection(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; details?: string }; node_errors?: Record<string, { class_type?: string; errors?: Array<{ message?: string; details?: string; type?: string }> }> };
    const nodes = Object.values(parsed.node_errors ?? {}).flatMap((node) => (node.errors ?? []).map((e) => `${node.class_type ?? "?"}: ${e.message ?? e.type ?? "errore"}${e.details ? ` (${e.details})` : ""}`));
    const missingFile = Object.values(parsed.node_errors ?? {}).some((node) => node.errors?.some((e) => e.type === "value_not_in_list"));
    const text = [parsed.error?.message, ...nodes.slice(0, 3)].filter(Boolean).join(" · ") || body.slice(0, 300);
    return missingFile ? `${text}. Manca un file di modello in ComfyUI, o il flusso lo chiama con un altro nome: «Verifica ComfyUI» dice quale.` : text;
  } catch {
    return body.slice(0, 300);
  }
}

export class ComfyUiImageService implements ImageService {
  readonly name = "comfyui";
  readonly model: string;
  readonly maxReferences: number;
  private readonly baseUrl: string;
  private readonly workflow: ComfyWorkflow;
  private readonly clientId = `comic-builder-${Math.random().toString(36).slice(2, 10)}`;

  constructor(private readonly options: ComfyUiOptions = {}) {
    this.baseUrl = (options.baseUrl?.trim() || COMFY_DEFAULT_URL).replace(/\/$/, "");
    this.workflow = parseComfyWorkflow(options.workflow);
    this.model = comfyModelName(this.workflow);
    this.maxReferences = comfyReferenceSlots(this.workflow).length;
  }

  /** Niente da pagare; il tempo è quello di una GPU di fascia media col flusso di partenza. */
  estimate(spec: RenderSpec): ImageEstimate {
    const megapixels = (spec.width * spec.height) / (1024 * 1024);
    return { usd: 0, seconds: Math.round(6 * megapixels + 2 * spec.references.length) };
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `${this.baseUrl}${path}`;
    const limited = requestSignal(signal, this.options.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(this.options.rewriteUrl ? this.options.rewriteUrl(url) : url, { ...init, signal: limited.signal });
    } catch (cause) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      if (limited.timedOut()) throw new ImageError(`ComfyUI non ha risposto in tempo su ${this.baseUrl}.`, this.name, true, cause);
      throw new ImageError(`ComfyUI non risponde su ${this.baseUrl}: è avviato? (python main.py, o l'app ComfyUI Desktop)`, this.name, false, cause);
    }
    // Un proxy davanti (il server di sviluppo) risponde 502 quando dietro non c'è nessuno.
    if (response.status === 502 || response.status === 504) throw new ImageError(`ComfyUI non risponde su ${this.baseUrl}: è avviato?`, this.name, false);
    if (response.status === 403) throw new ImageError("ComfyUI ha rifiutato la richiesta (403): se è avviato con --enable-cors-header o dietro un proxy, controlla che accetti questo indirizzo.", this.name, false);
    return response;
  }

  private async json<T>(response: Response, what: string, signal?: AbortSignal): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ImageError(`ComfyUI ha rifiutato ${what} (HTTP ${response.status}): ${describeRejection(text)}`, this.name, response.status >= 500);
    }
    return readBody(() => response.json() as Promise<T>, this.name, signal);
  }

  /** Cosa ha questo ComfyUI rispetto al flusso: nodi e file che mancano, prima di accodare. */
  async check(signal?: AbortSignal): Promise<ComfyEngineInfo> {
    const stats = await this.json<{ system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number }> }>(
      await this.call("/system_stats", { method: "GET", headers: { accept: "application/json" } }, signal),
      "la richiesta dello stato",
    );
    const info = await this.json<Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>>(
      await this.call("/object_info", { method: "GET", headers: { accept: "application/json" } }, signal),
      "l'elenco dei nodi",
    );
    const missingNodes = new Set<string>();
    const missingValues: ComfyEngineInfo["missingValues"] = [];
    for (const node of Object.values(this.workflow)) {
      const definition = info[node.class_type];
      if (!definition) {
        missingNodes.add(node.class_type);
        continue;
      }
      const inputs = { ...definition.input?.required, ...definition.input?.optional };
      for (const [key, value] of Object.entries(node.inputs)) {
        if (typeof value !== "string" || HAS_TOKEN.test(value)) continue;
        const spec = inputs[key];
        if (!Array.isArray(spec)) continue;
        // Due forme: [["a", "b"], {...}] e, nei nodi nuovi, ["COMBO", { options: ["a", "b"] }].
        const options = Array.isArray(spec[0]) ? (spec[0] as unknown[]) : spec[0] === "COMBO" ? ((spec[1] as { options?: unknown[] } | undefined)?.options ?? null) : null;
        if (options && !options.includes(value)) missingValues.push({ node: node.class_type, input: key, value });
      }
    }
    const device = stats.devices?.[0];
    return {
      version: stats.system?.comfyui_version ?? "?",
      device: device?.name ? `${device.name}${device.vram_total ? ` · ${Math.round(device.vram_total / 1024 ** 3)} GB` : ""}` : "?",
      missingNodes: [...missingNodes],
      missingValues,
    };
  }

  /** Un riferimento in `input/comic-builder/`, col nome dato dal contenuto: la stessa immagine non si carica due volte con due nomi. */
  private async upload(reference: ReferenceImage, signal?: AbortSignal): Promise<string> {
    const name = `${(await sha256Hex(reference.data)).slice(0, 24)}.${EXTENSION[reference.mediaType] ?? "png"}`;
    const form = multipart({ type: "input", subfolder: "comic-builder", overwrite: "true" }, { name, type: reference.mediaType, data: reference.data });
    const uploaded = await this.json<{ name?: string; subfolder?: string }>(
      await this.call("/upload/image", { method: "POST", headers: { "content-type": form.type, accept: "application/json" }, body: form.body }, signal),
      "il caricamento di un riferimento",
    );
    const file = uploaded.name ?? name;
    const folder = uploaded.subfolder ?? "comic-builder";
    return folder ? `${folder}/${file}` : file;
  }

  private async cancel(promptId: string): Promise<void> {
    const headers = { "content-type": "application/json" };
    try {
      const queue = (await (await this.call("/queue", { method: "GET", headers: { accept: "application/json" } })).json()) as { queue_running?: unknown[][] };
      // Si interrompe solo se il lavoro in corso è il nostro: quello di un altro non si tocca.
      if (queue.queue_running?.some((entry) => entry[1] === promptId)) await this.call("/interrupt", { method: "POST", headers, body: JSON.stringify({ prompt_id: promptId }) });
      else await this.call("/queue", { method: "POST", headers, body: JSON.stringify({ delete: [promptId] }) });
    } catch {
      // Annullare è un favore alla GPU: se non riesce, il lavoro finisce e basta.
    }
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const { spec, references, signal } = request;
    if (references.length > this.maxReferences) {
      throw new ImageError(`Il flusso ComfyUI ha ${this.maxReferences} posti per le immagini di riferimento: ne sono arrivate ${references.length}.`, this.name);
    }
    const started = Date.now();
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const images: string[] = [];
    for (const reference of references) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      images.push(await this.upload(reference, signal));
    }
    const prompt = fillComfyWorkflow(this.workflow, { prompt: spec.prompt, seed: spec.seed, width: spec.width, height: spec.height, images });

    const queued = await this.json<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(
      await this.call("/prompt", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ prompt, client_id: this.clientId }) }, signal),
      "il flusso",
    );
    const promptId = queued.prompt_id;
    if (!promptId) throw new ImageError("ComfyUI ha accettato il flusso senza restituire l'id del lavoro.", this.name, true);

    // Da qui il lavoro esiste in ComfyUI: qualunque uscita che non sia
    // l'immagine lo toglie dalla coda, o la GPU continua per nessuno.
    let finished = false;
    try {
      const result = await this.follow(promptId, started, sleep, signal);
      finished = true;
      return result;
    } catch (error) {
      throw settled(error);
    } finally {
      if (!finished) await this.cancel(promptId);
    }
  }

  /** Segue il lavoro accodato fino all'immagine. Il tempo limite parte dall'accodamento, non dal caricamento dei riferimenti. */
  private async follow(promptId: string, started: number, sleep: (ms: number) => Promise<void>, signal: AbortSignal | undefined): Promise<ImageResult> {
    const deadline = Date.now() + (this.options.timeoutMs ?? 15 * 60_000);
    const retry = { signal, sleep };
    for (;;) {
      if (signal?.aborted) throw new ImageCancelledError(this.name);
      if (Date.now() > deadline) {
        throw new ImageError("ComfyUI non ha finito in tempo: la coda è occupata da altro, o il modello non ci sta in memoria.", this.name, false);
      }
      await sleep(this.options.pollMs ?? 750);
      const history = await followUp(
        async () =>
          this.json<Record<string, HistoryEntry>>(
            await this.call(`/history/${encodeURIComponent(promptId)}`, { method: "GET", headers: { accept: "application/json" } }, signal),
            "lo storico",
            signal,
          ),
        retry,
      );
      const entry = history[promptId];
      if (!entry) continue;
      if (entry.status?.status_str === "error") {
        const failure = entry.status.messages?.find(([kind]) => kind === "execution_error")?.[1] as { node_type?: string; exception_message?: string } | undefined;
        const said = failure ? `${failure.node_type ?? "?"}: ${String(failure.exception_message ?? "").trim()}` : "errore sconosciuto";
        const memory = /out of memory|allocat/i.test(said) ? " Il modello non ci sta nella memoria della GPU: prova un modello più piccolo, o una risoluzione più bassa." : "";
        throw new ImageError(`ComfyUI non è riuscito a generare: ${said}.${memory}`, this.name, false);
      }
      if (entry.status && entry.status.completed === false && entry.status.status_str !== "success") continue;
      const outputs = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
      const image = outputs.find((i) => i.type === "output") ?? outputs[0];
      if (!image) {
        if (entry.status?.completed) throw new ImageError("ComfyUI ha finito senza immagini: il flusso ha un nodo SaveImage collegato?", this.name, false);
        continue;
      }
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" });
      const data = await followUp(async () => {
        const download = await this.call(`/view?${query}`, { method: "GET" }, signal);
        if (!download.ok) throw new ImageError(`Download dell'immagine da ComfyUI fallito (${download.status}).`, this.name, true);
        return new Uint8Array(await readBody(() => download.arrayBuffer(), this.name, signal));
      }, retry);
      const extension = image.filename.split(".").pop()?.toLowerCase();
      return {
        data,
        mediaType: extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png",
        meta: { model: this.model, durationMs: Date.now() - started, costUsd: 0, remoteId: promptId },
      };
    }
  }
}
