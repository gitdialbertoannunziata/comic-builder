import { useEffect, useSyncExternalStore } from "react";
import { desktop } from "./desktop.js";

/**
 * I modelli locali dell'app desktop, visti dalla UI: cosa c'è in questo
 * computer, cosa è installato, come si apre la procedura guidata. La logica
 * (catalogo, download, avvio dei motori) sta nel processo principale,
 * `packages/desktop/src/local`; qui ci sono la sua forma e uno stato
 * condiviso, perché Copione, scheda Arte e procedura guidata dicano la
 * stessa cosa.
 */
export type Backend = "metal" | "vulkan" | "cpu";
export type EngineKind = "text" | "image";

export interface Hardware {
  platform: string;
  arch: string;
  ramGB: number;
  gpu: { name: string; vendor: string; vramGB: number | null } | null;
  glibc: string | null;
  freeDiskGB: number | null;
}

export interface LocalOverview {
  hardware: Hardware;
  recommendation: { backend: Backend; memoryGB: number; text: string | null; image: string | null; notes: string[] };
  backends: Backend[];
  memory: Record<Backend, number>;
  blocked: Record<Backend, Record<EngineKind, string | null>>;
  models: Array<{ id: string; kind: EngineKind; label: string; hint: string; minMemoryGB: number; size: number }>;
  engineSize: Record<EngineKind, Partial<Record<Backend, number>>>;
  engines: Record<EngineKind, { label: string; version: string }>;
  state: { backend: Backend | null; memoryGB: number | null; engines: Partial<Record<EngineKind, { version: string; backend: Backend }>>; models: Partial<Record<EngineKind, string>> };
  running: EngineKind[];
  folder: string;
}

export interface InstallPlan {
  backend: Backend;
  memoryGB: number;
  text: string | null;
  image: string | null;
}

export interface InstallProgress {
  label: string;
  step: number;
  steps: number;
  phase: "download" | "extract" | "done";
  received: number;
  total: number;
}

export interface LocalBridge {
  overview(): Promise<LocalOverview>;
  install(plan: InstallPlan): Promise<LocalOverview>;
  cancel(): Promise<void>;
  start(kind: EngineKind): Promise<string>;
  stop(kind: EngineKind): Promise<void>;
  log(kind: EngineKind): Promise<string>;
  remove(): Promise<LocalOverview>;
  onProgress(callback: (progress: InstallProgress) => void): () => void;
}

export const local: LocalBridge | null = (desktop as unknown as { local?: LocalBridge } | null)?.local ?? null;

// --- Stato condiviso ---

let current: LocalOverview | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());

export function setLocalOverview(next: LocalOverview): void {
  current = next;
  publish();
}

export function refreshLocalModels(): Promise<void> {
  if (!local) return Promise.resolve();
  loading = local
    .overview()
    .then(setLocalOverview)
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Lo stato dei modelli locali; null finché non si sa (o fuori dall'app desktop). */
export function useLocalModels(): LocalOverview | null {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  useEffect(() => {
    if (local && !current && !loading) void refreshLocalModels();
  }, []);
  return value;
}

/** Il modello installato per un motore, con la sua etichetta; null se manca. */
export function installedModel(overview: LocalOverview | null, kind: EngineKind): { id: string; label: string } | null {
  const id = overview?.state.models[kind];
  const model = overview?.models.find((m) => m.id === id);
  return model ? { id: model.id, label: model.label } : null;
}

export function localModelIdentity(kind: EngineKind): string {
  return JSON.stringify([current?.state.models[kind] ?? null, current?.state.engines[kind] ?? null, current?.state.memoryGB ?? null]);
}

// --- Aprire la procedura guidata da qualunque punto ---

const openers = new Set<(focus?: EngineKind) => void>();

/** Chi mostra la procedura (l'App) si registra qui; Copione e scheda Arte la aprono con `openLocalModels`. */
export function onOpenLocalModels(open: (focus?: EngineKind) => void): () => void {
  openers.add(open);
  return () => openers.delete(open);
}

export function openLocalModels(focus?: EngineKind): void {
  openers.forEach((open) => open(focus));
}

export const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB`;
