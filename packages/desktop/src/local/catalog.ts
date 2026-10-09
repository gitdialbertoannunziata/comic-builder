/**
 * I modelli locali: cosa si può installare, da dove, e cosa conviene a
 * questo computer.
 *
 * Una sola strategia per tutto ciò che gira sul computer di chi disegna:
 * l'app scarica i binari ufficiali dei due motori — llama.cpp per lo
 * spoglio, stable-diffusion.cpp per le immagini — e i modelli GGUF da
 * Hugging Face, ne verifica il checksum, e li avvia e ferma da sé. Niente
 * da installare a parte, niente servizi di sistema, niente permessi di
 * amministratore. Tutto ciò che si scarica è fissato qui, versione e
 * SHA-256: aggiornare un motore o un modello è cambiare questo file.
 *
 * Solo modelli con licenza aperta (Apache 2.0) e scaricabili senza login:
 * un repository ad accesso riservato romperebbe la procedura guidata.
 */

export type Backend = "metal" | "vulkan" | "cpu";
export type EngineKind = "text" | "image";

export interface Download {
  url: string;
  sha256: string;
  size: number;
}

/** `${platform}-${arch}-${backend}`, come lo restituisce `variantKey`. */
export type VariantKey = string;

export interface Engine {
  id: "llama" | "sd";
  kind: EngineKind;
  label: string;
  version: string;
  /** Il nome dell'eseguibile dentro l'archivio (senza `.exe`). */
  binary: string;
  variants: Readonly<Record<VariantKey, Download>>;
}

export const ENGINES: Readonly<Record<EngineKind, Engine>> = {
  text: {
    id: "llama",
    kind: "text",
    label: "llama.cpp",
    version: "b11538",
    binary: "llama-server",
    variants: {
      "darwin-arm64-metal": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-macos-arm64.tar.gz", sha256: "291c46b9288975ec54771d4056911d9cb773b954afb6c5eba35dc9fa359d45f4", size: 12076988 },
      "darwin-x64-cpu": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-macos-x64.tar.gz", sha256: "610fa04364d1ba89ccfa5b18019a77c6a13039103426ab9ff907b5b49329f988", size: 11595994 },
      "win32-x64-vulkan": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-win-vulkan-x64.zip", sha256: "621ec0ed653ec9d40673be866558d2675eb54907ee4255ecfeb2739f2a6dccf5", size: 33459184 },
      "win32-x64-cpu": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-win-cpu-x64.zip", sha256: "8d27ba71dfb5c2f0733a048dfe3eea3edc0e31d7b831a25d3610c3db81dc0bec", size: 19513109 },
      "linux-x64-vulkan": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-ubuntu-vulkan-x64.tar.gz", sha256: "3d34b0be8a892b8926f95fe7bf7a5195781e1374bcfc5cdbac26ea5f86a1131b", size: 31761565 },
      "linux-x64-cpu": { url: "https://github.com/ggml-org/llama.cpp/releases/download/b11538/llama-b11538-bin-ubuntu-x64.tar.gz", sha256: "75c2d8da0ed790d7ebd0eeb3740a72eef8bce4a35745cf0306f1a9b72ff8f4d0", size: 17801383 },
    },
  },
  image: {
    id: "sd",
    kind: "image",
    label: "stable-diffusion.cpp",
    version: "master-951-f89d9b1",
    binary: "sd-server",
    variants: {
      "darwin-arm64-metal": { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-Darwin-macOS-26.6.2-arm64.zip", sha256: "8057dbfb1529b4e0bc07d35eaf68fa821e44bca6852428c539bf70602189bf92", size: 35154109 },
      "win32-x64-vulkan": { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-win-vulkan-x64.zip", sha256: "2c5bed22585ff678ff2c9077f5088d55c2d9c0faa948db7f2e689e1ccea701a9", size: 30117011 },
      "win32-x64-cpu": { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-win-cpu-x64.zip", sha256: "7c46bc1f4e89b22af9dd70e8d510dea2167c619676d23d313b83deffcd9b1ecc", size: 17536557 },
      "linux-x64-vulkan": { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip", sha256: "441a12efaf319bebd577f09a35fff862e154ebae2a19bdfdd61185e0d6071718", size: 36987163 },
      "linux-x64-cpu": { url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-951-f89d9b1/sd-master-f89d9b1-bin-Linux-Ubuntu-24.04-x86_64.zip", sha256: "2390e744f0c97f452df851581262c145218aa54157db795010c3244a46e07319", size: 26122036 },
    },
  },
};

/** Le build Linux di stable-diffusion.cpp sono fatte su Ubuntu 24.04: con una glibc più vecchia non partono. */
let sdMinGlibc = "2.38";
export const SD_MIN_GLIBC = () => sdMinGlibc;

export interface ModelFile extends Download {
  /** Il nome con cui sta su disco, nella cartella dei modelli. */
  file: string;
  /** Il ruolo del file per il motore: per le immagini servono tre pezzi. */
  role: "model" | "diffusion" | "text-encoder" | "vae";
}

export interface ModelOption {
  id: string;
  kind: EngineKind;
  label: string;
  /** Per chi sceglie: a cosa serve, cosa costa. */
  hint: string;
  /** Il nome che finisce nell'esito dello spoglio o nello spec dell'immagine. */
  model: string;
  /** Memoria (GPU, o RAM sulla CPU e su Apple Silicon) sotto la quale non conviene. */
  minMemoryGB: number;
  files: readonly ModelFile[];
}

const HF = "https://huggingface.co";

/** Il text encoder e il VAE di FLUX.2 [klein] 4B: gli stessi per ogni variante del modello. */
const KLEIN_SHARED: readonly ModelFile[] = [
  {
    role: "text-encoder",
    file: "Qwen3-4B-Q4_K_M.gguf",
    url: `${HF}/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`,
    sha256: "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a",
    size: 2497281312,
  },
  {
    // Il VAE di FLUX.2 [dev] sta in un repository ad accesso riservato; questo è di Black Forest Labs, Apache 2.0, libero.
    role: "vae",
    file: "flux2-full-encoder-small-decoder.safetensors",
    url: `${HF}/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors`,
    sha256: "ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62",
    size: 249519092,
  },
];

export const MODELS: readonly ModelOption[] = [
  {
    id: "qwen3.5-4b",
    kind: "text",
    label: "Leggero — Qwen3.5 4B",
    hint: "il più veloce e il più piccolo; per i copioni lunghi e sottili sbaglia di più",
    model: "qwen3.5-4b",
    minMemoryGB: 4,
    files: [{ role: "model", file: "Qwen3.5-4B-Q4_K_M.gguf", url: `${HF}/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf`, sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4", size: 2740937888 }],
  },
  {
    id: "qwen3.5-9b",
    kind: "text",
    label: "Equilibrato — Qwen3.5 9B",
    hint: "lo spoglio regge meglio personaggi e scene; chiede una GPU da 8 GB",
    model: "qwen3.5-9b",
    minMemoryGB: 7,
    files: [{ role: "model", file: "Qwen3.5-9B-Q4_K_M.gguf", url: `${HF}/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf`, sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8", size: 5680522464 }],
  },
  {
    id: "gemma-4-12b",
    kind: "text",
    label: "Accurato — Gemma 4 12B",
    hint: "il più attento ai dettagli del testo; chiede una GPU da 12 GB o un Mac con 16 GB",
    model: "gemma-4-12b",
    minMemoryGB: 9.5,
    files: [{ role: "model", file: "gemma-4-12b-it-Q4_K_M.gguf", url: `${HF}/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf`, sha256: "0a270ec9fe6b34f4a0d33992b6135117b484ebc4766ab76b51d4ae8c457e4c42", size: 7121861440 }],
  },
  {
    id: "flux2-klein-4b-q4",
    kind: "image",
    label: "FLUX.2 [klein] 4B, compatto",
    hint: "la versione ridotta a 4 bit: entra in 6–8 GB",
    model: "flux-2-klein-4b",
    minMemoryGB: 6,
    files: [
      { role: "diffusion", file: "flux-2-klein-4b-Q4_0.gguf", url: `${HF}/leejet/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q4_0.gguf`, sha256: "d1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4", size: 2460378560 },
      ...KLEIN_SHARED,
    ],
  },
  {
    id: "flux2-klein-4b-q8",
    kind: "image",
    label: "FLUX.2 [klein] 4B, pieno",
    hint: "la versione a 8 bit, più fedele: chiede 12 GB",
    model: "flux-2-klein-4b",
    minMemoryGB: 12,
    files: [
      { role: "diffusion", file: "flux-2-klein-4b-Q8_0.gguf", url: `${HF}/leejet/FLUX.2-klein-4B-GGUF/resolve/main/flux-2-klein-4b-Q8_0.gguf`, sha256: "0bba6951258ec8f92d51114a8fa13e66828297bfff58a738f52729b3ef66fa28", size: 4300629440 },
      ...KLEIN_SHARED,
    ],
  },
];

// --- Questo computer ---

export interface Hardware {
  platform: string;
  arch: string;
  /** In GB. */
  ramGB: number;
  /** La GPU, se se ne riconosce una: nome, produttore, memoria se si sa leggerla. */
  gpu: { name: string; vendor: "nvidia" | "amd" | "intel" | "apple" | "other"; vramGB: number | null } | null;
  /** Solo Linux: la glibc, che decide se il motore delle immagini parte. */
  glibc: string | null;
  /** Spazio libero dove vanno i modelli, in GB. */
  freeDiskGB: number | null;
}

export function variantKey(hardware: Pick<Hardware, "platform" | "arch">, backend: Backend): VariantKey {
  return `${hardware.platform}-${hardware.arch}-${backend}`;
}

const versionAtLeast = (version: string, min: string) => {
  const [a = 0, b = 0] = version.split(".").map(Number);
  const [x = 0, y = 0] = min.split(".").map(Number);
  return a > x || (a === x && b >= y);
};

/** Perché un motore non si può installare qui; null se si può. */
export function unsupported(kind: EngineKind, hardware: Hardware, backend: Backend): string | null {
  if (!ENGINES[kind].variants[variantKey(hardware, backend)]) {
    if (kind === "image" && hardware.platform === "darwin" && hardware.arch === "x64") return "Sui Mac con processore Intel il motore delle immagini non è disponibile.";
    return `Il motore ${kind === "text" ? "dello spoglio" : "delle immagini"} non ha una versione per questo sistema con questa accelerazione.`;
  }
  if (kind === "image" && hardware.platform === "linux" && hardware.glibc && !versionAtLeast(hardware.glibc, sdMinGlibc)) {
    return `Il motore delle immagini vuole un Linux recente (glibc ${sdMinGlibc}, come Ubuntu 24.04): qui c'è la ${hardware.glibc}.`;
  }
  return null;
}

/** Le accelerazioni possibili qui, la migliore per prima. */
export function backends(hardware: Pick<Hardware, "platform" | "arch" | "gpu">): Backend[] {
  if (hardware.platform === "darwin") return hardware.arch === "arm64" ? ["metal"] : ["cpu"];
  return hardware.gpu && hardware.gpu.vendor !== "apple" ? ["vulkan", "cpu"] : ["cpu", "vulkan"];
}

/**
 * Quanta memoria ha il modello per girare: quella della GPU con Vulkan, una
 * parte della RAM su Apple Silicon (è condivisa col resto del sistema) e
 * sulla CPU. Con una GPU di cui non si legge la memoria si stima prudenti.
 */
export function memoryFor(hardware: Hardware, backend: Backend): number {
  if (backend === "metal" || backend === "cpu") return Math.round(hardware.ramGB * 0.6 * 10) / 10;
  if (hardware.gpu?.vramGB) return hardware.gpu.vramGB;
  return hardware.gpu?.vendor === "nvidia" || hardware.gpu?.vendor === "amd" ? 8 : 4;
}

export interface Recommendation {
  backend: Backend;
  memoryGB: number;
  text: string | null;
  image: string | null;
  /** Cose da dire prima di scaricare: la CPU è lenta, il disco è poco. */
  notes: string[];
}

export function recommend(hardware: Hardware): Recommendation {
  const backend = backends(hardware)[0]!;
  const memoryGB = memoryFor(hardware, backend);
  const notes: string[] = [];
  const fits = (kind: EngineKind) => MODELS.filter((m) => m.kind === kind && m.minMemoryGB <= memoryGB).sort((a, b) => b.minMemoryGB - a.minMemoryGB);

  const text = unsupported("text", hardware, backend) ? null : (fits("text")[0] ?? MODELS.find((m) => m.kind === "text")!).id;
  let image: string | null = null;
  const imageBlocked = unsupported("image", hardware, backend);
  if (imageBlocked) notes.push(imageBlocked);
  else if (backend === "cpu") notes.push("Senza una GPU le immagini in locale si possono fare, ma ognuna chiede minuti: meglio il servizio cloud per le immagini.");
  else image = fits("image")[0]?.id ?? null;
  if (backend === "cpu") notes.push("Lo spoglio sulla CPU funziona, ma un capitolo può chiedere diversi minuti.");
  if (!image && !imageBlocked && backend !== "cpu") notes.push(`Con ${memoryGB} GB per il modello le immagini in locale non ci stanno bene: meglio il servizio cloud.`);
  return { backend, memoryGB, text, image, notes };
}

/** Quanto si scarica per una scelta, motori compresi, contando una volta i file in comune. */
export function downloadSize(hardware: Hardware, backend: Backend, choice: { text: string | null; image: string | null }): number {
  const files = new Map<string, number>();
  for (const id of [choice.text, choice.image]) {
    const option = MODELS.find((m) => m.id === id);
    if (!option) continue;
    const engine = ENGINES[option.kind].variants[variantKey(hardware, backend)];
    if (engine) files.set(engine.url, engine.size);
    for (const file of option.files) files.set(file.url, file.size);
  }
  return [...files.values()].reduce((a, b) => a + b, 0);
}

/**
 * Solo per lo sviluppo e le prove: sostituisce motori e modelli con quelli di
 * un catalogo finto (file piccoli serviti in locale), così la procedura
 * guidata si prova da capo a fondo senza scaricare gigabyte.
 */
export function applyCatalogOverride(data: { engines?: Partial<Record<EngineKind, Engine>>; models?: ModelOption[]; sdMinGlibc?: string }): void {
  if (data.engines) Object.assign(ENGINES, data.engines);
  if (data.sdMinGlibc) sdMinGlibc = data.sdMinGlibc;
  if (data.models) (MODELS as ModelOption[]).splice(0, MODELS.length, ...data.models);
}
