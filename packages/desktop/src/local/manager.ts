import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, promises as fs, type WriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { extract, findBinary } from "./archive.js";
import { backends, downloadSize, ENGINES, memoryFor, MODELS, recommend, unsupported, variantKey, type Backend, type EngineKind, type Hardware, type ModelOption } from "./catalog.js";
import { download, type Progress } from "./download.js";
import { detectHardware } from "./hardware.js";

/**
 * I motori locali: cosa è installato, come si installa, come si avviano.
 *
 * Tutto sta nella cartella dell'app (`userData/local`): motori, modelli,
 * stato, log. Niente fuori di lì, niente servizi di sistema: togliere i
 * modelli locali è cancellare quella cartella, e l'app lo sa fare.
 */

const root = () => path.join(app.getPath("userData"), "local");
const modelsDir = () => path.join(root(), "models");
const enginesDir = () => path.join(root(), "engines");
const stateFile = () => path.join(root(), "state.json");

interface InstalledEngine {
  version: string;
  backend: Backend;
  binary: string;
}

export interface LocalState {
  backend: Backend | null;
  /** Memoria per i modelli, in GB: decide se il motore delle immagini tiene i pesi in RAM. */
  memoryGB: number | null;
  engines: Partial<Record<EngineKind, InstalledEngine>>;
  /** Il modello scelto e installato, per motore. */
  models: Partial<Record<EngineKind, string>>;
}

const EMPTY: LocalState = { backend: null, memoryGB: null, engines: {}, models: {} };

export async function readState(): Promise<LocalState> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(stateFile(), "utf8")) as Partial<LocalState>) };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: LocalState) {
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(state, null, 2));
}

// --- Panoramica, per la procedura guidata ---

export interface Overview {
  hardware: Hardware;
  recommendation: ReturnType<typeof recommend>;
  backends: Backend[];
  /** Memoria per i modelli con ciascuna accelerazione, in GB (stimata dove non si legge). */
  memory: Record<Backend, number>;
  /** Perché un motore non si può installare, per accelerazione. */
  blocked: Record<Backend, Record<EngineKind, string | null>>;
  models: Array<Pick<ModelOption, "id" | "kind" | "label" | "hint" | "minMemoryGB"> & { size: number }>;
  /** Quanto pesa il motore, per accelerazione: si aggiunge alla dimensione dei modelli. */
  engineSize: Record<EngineKind, Partial<Record<Backend, number>>>;
  engines: Record<EngineKind, { label: string; version: string }>;
  state: LocalState;
  running: EngineKind[];
  folder: string;
}

let hardwareCache: Promise<Hardware> | null = null;

export async function overview(): Promise<Overview> {
  const hardware = await (hardwareCache ??= detectHardware(modelsDir()));
  const all: Backend[] = ["metal", "vulkan", "cpu"];
  const engineSize = { text: {}, image: {} } as Overview["engineSize"];
  const blocked = {} as Overview["blocked"];
  for (const backend of all) {
    blocked[backend] = { text: unsupported("text", hardware, backend), image: unsupported("image", hardware, backend) };
    for (const kind of ["text", "image"] as const) {
      const variant = ENGINES[kind].variants[variantKey(hardware, backend)];
      if (variant) engineSize[kind][backend] = variant.size;
    }
  }
  return {
    hardware,
    recommendation: recommend(hardware),
    backends: backends(hardware),
    memory: { metal: memoryFor(hardware, "metal"), vulkan: memoryFor(hardware, "vulkan"), cpu: memoryFor(hardware, "cpu") },
    blocked,
    models: MODELS.map(({ id, kind, label, hint, minMemoryGB, files }) => ({ id, kind, label, hint, minMemoryGB, size: files.reduce((n, f) => n + f.size, 0) })),
    engineSize,
    engines: { text: { label: ENGINES.text.label, version: ENGINES.text.version }, image: { label: ENGINES.image.label, version: ENGINES.image.version } },
    state: await readState(),
    running: [...running.keys()],
    folder: root(),
  };
}

// --- Installazione ---

export interface InstallPlan {
  backend: Backend;
  memoryGB: number;
  text: string | null;
  image: string | null;
}

export interface InstallProgress extends Progress {
  /** Cosa si sta scaricando, per l'autore: «llama.cpp», «Qwen3.5 9B — modello». */
  label: string;
  step: number;
  steps: number;
  phase: "download" | "extract" | "done";
}

const ROLE_LABEL = { model: "modello", diffusion: "modello", "text-encoder": "text encoder", vae: "VAE" } as const;

export async function install(plan: InstallPlan, options: { signal: AbortSignal; onProgress: (progress: InstallProgress) => void }): Promise<LocalState> {
  const hardware = await (hardwareCache ??= detectHardware(modelsDir()));
  const state = await readState();
  const chosen = (["text", "image"] as const).flatMap((kind) => {
    const id = plan[kind];
    const option = MODELS.find((m) => m.id === id && m.kind === kind);
    return option ? [option] : [];
  });
  for (const option of chosen) {
    const reason = unsupported(option.kind, hardware, plan.backend);
    if (reason) throw new Error(reason);
  }
  if (hardware.freeDiskGB !== null && downloadSize(hardware, plan.backend, plan) / 1e9 > hardware.freeDiskGB - 1) {
    throw new Error(`Servono ${(downloadSize(hardware, plan.backend, plan) / 1e9).toFixed(1)} GB e sul disco ne restano ${hardware.freeDiskGB}: libera spazio e riprova.`);
  }

  // I passi: per ogni motore il binario (se manca o è di un'altra versione) e i file del modello.
  type Step = { label: string; run: (onProgress: (p: Progress) => void) => Promise<void> };
  const steps: Step[] = [];
  for (const option of chosen) {
    const engine = ENGINES[option.kind];
    const variant = engine.variants[variantKey(hardware, plan.backend)]!;
    const current = state.engines[option.kind];
    if (!current || current.version !== engine.version || current.backend !== plan.backend) {
      steps.push({
        label: `${engine.label} (${plan.backend})`,
        run: async (onProgress) => {
          const base = `${engine.id}-${engine.version}-${plan.backend}`;
          const archive = path.join(enginesDir(), `${base}${variant.url.endsWith(".zip") ? ".zip" : ".tar.gz"}`);
          await download(variant, archive, { signal: options.signal, onProgress });
          const dir = path.join(enginesDir(), base);
          await fs.rm(dir, { recursive: true, force: true });
          await extract(archive, dir);
          const binary = await findBinary(dir, engine.binary);
          if (!binary) throw new Error(`Nell'archivio di ${engine.label} non c'è ${engine.binary}.`);
          await fs.chmod(binary, 0o755);
          await fs.rm(archive, { force: true });
          state.engines[option.kind] = { version: engine.version, backend: plan.backend, binary };
          await writeState(state);
        },
      });
    }
    for (const file of option.files) {
      steps.push({
        label: `${option.label} — ${ROLE_LABEL[file.role]}`,
        run: (onProgress) => download(file, path.join(modelsDir(), file.file), { signal: options.signal, onProgress }),
      });
    }
  }

  for (const [index, step] of steps.entries()) {
    options.onProgress({ label: step.label, step: index + 1, steps: steps.length, phase: "download", received: 0, total: 0 });
    await step.run((p) => options.onProgress({ label: step.label, step: index + 1, steps: steps.length, phase: "download", ...p }));
  }

  // Quello che non si è scelto resta com'era: si può avere solo lo spoglio, o solo le immagini.
  for (const option of chosen) state.models[option.kind] = option.id;
  state.backend = plan.backend;
  state.memoryGB = plan.memoryGB;
  await writeState(state);
  options.onProgress({ label: "fatto", step: steps.length, steps: steps.length, phase: "done", received: 0, total: 0 });
  return state;
}

/** Toglie tutto: motori, modelli, stato. Si riparte dalla procedura guidata. */
export async function removeAll(): Promise<void> {
  stopAll();
  await fs.rm(root(), { recursive: true, force: true });
}

// --- Avvio ---

interface Running {
  process: ChildProcess;
  url: string;
  ready: Promise<string>;
  log: string[];
}

const running = new Map<EngineKind, Running>();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("Nessuna porta libera"))));
    });
  });
}

function argsFor(kind: EngineKind, option: ModelOption, state: LocalState, port: number): string[] {
  const file = (role: string) => path.join(modelsDir(), option.files.find((f) => f.role === role)!.file);
  if (kind === "text") {
    return [
      "-m", file("model"),
      "--host", "127.0.0.1", "--port", String(port),
      // Uno spoglio intero in una richiesta: copione, istruzioni e risposta stanno in 16k token.
      "-c", "16384", "-np", "1", "--jinja",
      ...(state.backend !== "cpu" ? ["-ngl", "999"] : []),
    ];
  }
  return [
    "--diffusion-model", file("diffusion"),
    "--llm", file("text-encoder"),
    "--vae", file("vae"),
    "--listen-ip", "127.0.0.1", "--listen-port", String(port),
    "--diffusion-fa",
    // Con poca memoria sulla GPU i pesi stanno in RAM e salgono a turno: più lento, ma ci sta.
    ...(state.backend === "vulkan" && (state.memoryGB ?? 0) < 12 ? ["--offload-to-cpu"] : []),
  ];
}

/** L'indirizzo a cui il motore risponde quando è pronto. */
const HEALTH: Record<EngineKind, string> = { text: "/health", image: "/sdcpp/v1/capabilities" };

/**
 * Avvia il motore (o restituisce quello già avviato) e aspetta che sia
 * pronto: caricare un modello di gigabyte dal disco chiede secondi, sulla
 * CPU anche minuti. L'altro motore si ferma prima: sulle macchine che hanno
 * memoria per uno solo, spoglio e immagini vanno a turno.
 */
export async function start(kind: EngineKind): Promise<string> {
  const current = running.get(kind);
  if (current && current.process.exitCode === null) return current.ready;
  const state = await readState();
  const engine = state.engines[kind];
  const option = MODELS.find((m) => m.id === state.models[kind]);
  if (!engine || !option) throw new Error(`I modelli locali ${kind === "text" ? "per lo spoglio" : "per le immagini"} non sono installati: aprili da Progetto → Modelli locali…`);
  for (const other of running.keys()) if (other !== kind) stop(other);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const dir = path.dirname(engine.binary);
  await fs.mkdir(path.join(root(), "logs"), { recursive: true });
  const logFile: WriteStream = createWriteStream(path.join(root(), "logs", `${kind}.log`), { flags: "w" });
  const child = spawn(engine.binary, argsFor(kind, option, state, port), {
    cwd: dir,
    windowsHide: true,
    // Le librerie del motore stanno accanto al binario.
    env: { ...process.env, ...(process.platform === "linux" ? { LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : {}) },
  });
  const log: string[] = [];
  const collect = (chunk: Buffer) => {
    logFile.write(chunk);
    log.push(...chunk.toString("utf8").split("\n").filter(Boolean));
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("exit", () => {
    logFile.end();
    if (running.get(kind)?.process === child) running.delete(kind);
  });

  const ready = (async () => {
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Il motore ${kind === "text" ? "dello spoglio" : "delle immagini"} si è chiuso all'avvio: ${log.slice(-3).join(" · ") || "nessun messaggio"}`);
      }
      try {
        const response = await fetch(`${url}${HEALTH[kind]}`);
        if (response.ok) return url;
      } catch {
        // Non ascolta ancora.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    stop(kind);
    throw new Error("Il motore non è stato pronto in dieci minuti: il modello forse non ci sta in memoria.");
  })();
  running.set(kind, { process: child, url, ready, log });
  ready.catch(() => undefined);
  return ready;
}

export function stop(kind: EngineKind): void {
  const current = running.get(kind);
  if (!current) return;
  running.delete(kind);
  current.process.kill();
}

export function stopAll(): void {
  for (const kind of [...running.keys()]) stop(kind);
}

export function recentLog(kind: EngineKind): string {
  return (running.get(kind)?.log ?? []).join("\n");
}
