import { artMediaType, renderPaths, specHash, type Command, type ImageSize, type Panel, type ProjectStore, type RenderSpec } from "@comic-builder/core";
import { runRenderQueue, type ImageRequest, type ImageService, type ReferenceImage, type RenderJob } from "@comic-builder/image";
import { imageSize } from "./useArtWatcher.js";

/** Un pannello da generare, con lo spec che il documento compila adesso. */
export interface GenerationItem {
  pageId: string;
  panel: Panel;
  spec: RenderSpec;
}

export interface GenerationReport {
  done: number;
  /** Trovati già in `renders/`: lo stesso spec era stato generato prima, e non si paga due volte. */
  cached: number;
  cancelled: number;
  failed: Array<{ panelId: string; error: string }>;
  /** Addebitato dal fornitore, dove lo dichiara. */
  costUsd: number;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let batch = 0;

/**
 * Passo [3] della pipeline (§9.2): per ogni spec, il file in cache se c'è,
 * altrimenti il servizio. Ogni immagine si scrive e si collega appena
 * arriva — una coda interrotta a metà non perde ciò che ha già pagato — con
 * accanto il sidecar che dice da quale spec viene (§5.7).
 */
export async function generatePanels(input: {
  store: ProjectStore;
  service: ImageService;
  items: readonly GenerationItem[];
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number }) => void;
}): Promise<GenerationReport> {
  const { store, service, items, run } = input;
  const report: GenerationReport = { done: 0, cached: 0, cancelled: 0, failed: [], costUsd: 0 };
  const gesture = `generate-${++batch}`;
  const total = items.length;
  let finished = 0;
  const tick = () => input.onProgress?.({ done: ++finished, total });

  // Le dimensioni vere dell'immagine, per l'inquadratura; se non si riesce a leggerle, quelle chieste al modello.
  const sizeOf = async (item: GenerationItem, bytes: Uint8Array): Promise<ImageSize> =>
    (await imageSize(new Blob([bytes as BlobPart], { type: "image/png" }))) ?? { width: item.spec.width, height: item.spec.height };

  // Un'immagine nuova riparte centrata, senza l'inquadratura di quella di prima: come un disegno nuovo importato.
  const link = (item: GenerationItem, file: string, size: ImageSize) =>
    run(
      {
        type: "panel.update",
        pageId: item.pageId,
        panelId: item.panel.id,
        patch: { render: { ...item.panel.render, [item.spec.target]: { spec_hash: specHash(item.spec), file, engine: service.name, rendered_at: new Date().toISOString(), size } } },
      },
      { gesture },
    );

  const jobs: Array<RenderJob & { item: GenerationItem }> = [];
  for (const item of items) {
    const { image } = renderPaths(item.spec);
    const cached = await store.readBytes(image);
    if (cached) {
      link(item, image, await sizeOf(item, cached));
      report.cached++;
      tick();
      continue;
    }
    jobs.push({
      id: item.panel.id,
      item,
      request: async (): Promise<ImageRequest> => ({ spec: item.spec, references: await readReferences(store, item.spec) }),
    });
  }

  const byId = new Map(jobs.map((job) => [job.id, job.item]));
  await runRenderQueue(jobs, {
    service,
    // Più tentativi del default: col limite di richieste al minuto di un
    // deployment, una pagina intera aspetta più volte prima di finire.
    retries: 5,
    ...(input.signal ? { signal: input.signal } : {}),
    onOutcome: async (outcome) => {
      const item = byId.get(outcome.id)!;
      if (outcome.status === "done") {
        const paths = renderPaths(item.spec);
        await store.writeBytes(paths.image, outcome.result.data);
        const references = await Promise.all(outcome.request.references.map(async (r) => ({ path: r.path, sha256: await sha256(r.data) })));
        await store.writeText(
          paths.sidecar,
          `${JSON.stringify({ spec: item.spec, spec_hash: specHash(item.spec), engine: service.name, rendered_at: new Date().toISOString(), cost_usd: outcome.result.meta.costUsd, remote_id: outcome.result.meta.remoteId ?? null, references }, null, 2)}\n`,
        );
        link(item, paths.image, await sizeOf(item, outcome.result.data));
        report.done++;
        report.costUsd += outcome.result.meta.costUsd ?? 0;
      } else if (outcome.status === "failed") {
        report.failed.push({ panelId: outcome.id, error: outcome.error });
      } else {
        report.cancelled++;
      }
      tick();
    },
  });

  input.endGesture();
  return report;
}

const WHERE: Record<RenderSpec["references"][number]["kind"], string> = {
  style: "dallo stile dell'opera",
  location: "dalla scheda del luogo",
  character: "dalla scheda del personaggio",
};

/** I file dei riferimenti dello spec, letti dal progetto. Uno che manca ferma la generazione, e dice da dove toglierlo. */
export async function readReferences(store: ProjectStore, spec: RenderSpec): Promise<ReferenceImage[]> {
  const references: ReferenceImage[] = [];
  for (const reference of spec.references) {
    const data = await store.readBytes(reference.path);
    if (!data) throw new Error(`Riferimento non trovato: ${reference.path}. Toglilo ${WHERE[reference.kind]}, o rimetti il file.`);
    references.push({ path: reference.path, data, mediaType: artMediaType(reference.path) ?? "image/png" });
  }
  return references;
}

/**
 * Una sola immagine di riferimento (la vista di un personaggio, la tavola
 * di un luogo), scritta dove dice `path`. Passa dalla coda anche se è una:
 * è la coda che aspetta il limite di richieste al minuto e riprova.
 */
export async function generateReference(input: { store: ProjectStore; service: ImageService; spec: RenderSpec; path: string }): Promise<{ costUsd: number }> {
  const { store, service, spec, path } = input;
  const references = await readReferences(store, spec);
  const [outcome] = await runRenderQueue([{ id: spec.panel, request: () => ({ spec, references }) }], { service, retries: 5 });
  if (!outcome || outcome.status !== "done") throw new Error(outcome?.status === "failed" ? outcome.error : "Generazione interrotta.");
  await store.writeBytes(path, outcome.result.data);
  return { costUsd: outcome.result.meta.costUsd ?? 0 };
}

/**
 * Curatela: un render riuscito diventa riferimento — di un personaggio, di
 * un luogo, dello stile dell'opera. Copia il file, perché la cache dei
 * render resta cancellabile (§5.8).
 */
export async function promoteRender(store: ProjectStore, file: string, directory: string): Promise<string | null> {
  const bytes = await store.readBytes(file);
  if (!bytes) return null;
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/@[^.]*/, "");
  const path = `${directory}/${name}`;
  await store.writeBytes(path, bytes);
  return path;
}
