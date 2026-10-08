import { artMediaType, renderPaths, specHash, type Command, type Panel, type ProjectStore, type RenderSpec } from "@comic-builder/core";
import { runRenderQueue, type ImageRequest, type ImageService, type RenderJob } from "@comic-builder/image";

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

  const link = (item: GenerationItem, file: string) =>
    run(
      {
        type: "panel.update",
        pageId: item.pageId,
        panelId: item.panel.id,
        patch: { render: { ...item.panel.render, [item.spec.target]: { spec_hash: specHash(item.spec), file, engine: service.name, rendered_at: new Date().toISOString() } } },
      },
      { gesture },
    );

  const jobs: Array<RenderJob & { item: GenerationItem }> = [];
  for (const item of items) {
    const { image } = renderPaths(item.spec);
    if (await store.readBytes(image)) {
      link(item, image);
      report.cached++;
      tick();
      continue;
    }
    jobs.push({
      id: item.panel.id,
      item,
      request: async (): Promise<ImageRequest> => {
        const references = [];
        for (const reference of item.spec.references) {
          const data = await store.readBytes(reference.path);
          if (!data) throw new Error(`Riferimento non trovato: ${reference.path}. Toglilo dalla scheda di ${reference.character}, o rimetti il file.`);
          references.push({ path: reference.path, data, mediaType: artMediaType(reference.path) ?? "image/png" });
        }
        return { spec: item.spec, references };
      },
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
        link(item, paths.image);
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

/** Curatela (F5): un render riuscito diventa riferimento del personaggio. Copia il file: la cache dei render resta cancellabile. */
export async function promoteRender(store: ProjectStore, file: string, character: string): Promise<string | null> {
  const bytes = await store.readBytes(file);
  if (!bytes) return null;
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/@[^.]*/, "");
  const path = `characters/${character}/${name}`;
  await store.writeBytes(path, bytes);
  return path;
}
