import {
  BalloonStyleSchema,
  DraftStyleSchema,
  LetteringConfigSchema,
  finishTargetExport,
  findTarget,
  issue,
  planTargetExport,
  shownArt,
  type ExportContext,
  type ExportFile,
  type Page,
  type PageTarget,
  type ProjectDoc,
  type ProjectStore,
  type RenderJob,
  type TargetStyles,
  type ValidationIssue,
} from "@comic-builder/core";
import { measureWith } from "@comic-builder/lettering";
import { loadSampleFont, sampleFontPath } from "@comic-builder/lettering/sampleFont";
import { rasterizeSvgToPng } from "@comic-builder/export";

/**
 * Anteprima ed export in Node: la stessa pianificazione del Core che usa
 * l'app (`planTargetExport`), rasterizzata con resvg invece che col canvas
 * del browser. Il font è quello dell'app (Comic Neue): misura e disegno
 * devono usare lo stesso file, o il testo sborda dai balloon.
 */

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function primaryPageTarget(doc: ProjectDoc): PageTarget {
  const pages = doc.project.targets.filter((t): t is PageTarget => t.kind === "page");
  const primary = pages.find((t) => t.primary) ?? pages[0];
  if (!primary) throw new Error("The project declares no page target.");
  return primary;
}

function stylesOf(doc: ProjectDoc): TargetStyles {
  return {
    lettering: LetteringConfigSchema.parse(doc.project.lettering),
    balloonStyle: BalloonStyleSchema.parse(doc.project.balloon_style),
    draftStyle: DraftStyleSchema.parse(doc.project.draft_style),
  };
}

/** L'immagine che ogni pannello mostra (arte dell'autore o render del target), come data URI: resvg non legge percorsi relativi al progetto. */
async function artOf(store: ProjectStore, pages: readonly Page[], targetId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const page of pages) {
    for (const panel of page.panels) {
      const shown = shownArt(panel, targetId);
      if (!shown) continue;
      const bytes = await store.readBytes(shown.file);
      if (!bytes) continue;
      const extension = shown.file.split(".").pop()?.toLowerCase() ?? "";
      out.set(panel.id, `data:${MEDIA_TYPES[extension] ?? "image/png"};base64,${Buffer.from(bytes).toString("base64")}`);
    }
  }
  return out;
}

function chapterPages(doc: ProjectDoc, chapterId: string): { chapter: ProjectDoc["chapters"]["chapters"][number]; pages: Page[] } {
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`);
  const pages = chapter.pages.flatMap((id) => (doc.pages[id] ? [doc.pages[id]] : []));
  return { chapter, pages };
}

async function context(store: ProjectStore, doc: ProjectDoc, chapterId: string, pages: Page[], draft: boolean): Promise<ExportContext> {
  const { chapter } = chapterPages(doc, chapterId);
  return {
    project: doc.project,
    pages,
    chapter: { id: chapter.id, number: chapter.number, title: chapter.title },
    styles: stylesOf(doc),
    measure: measureWith(loadSampleFont()),
    draft,
    art: await artOf(store, pages, primaryPageTarget(doc).id),
  };
}

/** resvg produce solo PNG: un target JPEG esce in PNG, e lo si dice invece di scrivere un .jpg che non lo è. */
function rasterize(job: RenderJob, widthPx = job.width): Uint8Array {
  return rasterizeSvgToPng(job.svg, { widthPx, fontFiles: [sampleFontPath], background: "#ffffff" }).data;
}

/** Una pagina in PNG, nel target canonico: per far vedere all'agente quello che ha costruito. */
export async function previewPage(store: ProjectStore, doc: ProjectDoc, pageId: string, options: { draft: boolean; widthPx: number }): Promise<{ png: Uint8Array; issues: ValidationIssue[] }> {
  const page = doc.pages[pageId];
  if (!page) throw new Error(`Unknown page: ${pageId}`);
  const chapter = doc.chapters.chapters.find((c) => c.pages.includes(pageId));
  if (!chapter) throw new Error(`Page ${pageId} belongs to no chapter.`);
  const ctx = await context(store, doc, chapter.id, [page], options.draft);
  const plan = planTargetExport(ctx, primaryPageTarget(doc).id, "");
  const job = plan.jobs[0];
  if (!job) throw new Error(`Nothing to render for page ${pageId}.`);
  return { png: rasterize(job, Math.min(options.widthPx, job.width)), issues: plan.issues };
}

export interface ExportResult {
  files: ExportFile[];
  issues: ValidationIssue[];
}

/** I file di un capitolo per i target scelti (default: il target pagina principale), pronti da scrivere. */
export async function exportChapter(store: ProjectStore, doc: ProjectDoc, chapterId: string, targetIds: readonly string[], draft: boolean): Promise<ExportResult> {
  const { pages } = chapterPages(doc, chapterId);
  if (pages.length === 0) throw new Error(`Chapter ${chapterId} has no pages to export.`);
  const ctx = await context(store, doc, chapterId, pages, draft);
  const files: ExportFile[] = [];
  const issues: ValidationIssue[] = [];
  const ids = targetIds.length > 0 ? targetIds : [primaryPageTarget(doc).id];

  for (const id of ids) {
    const target = findTarget(doc.project, id);
    if (!target) throw new Error(`Unknown target: ${id}. Declared: ${doc.project.targets.map((t) => t.id).join(", ")}`);
    const plan = planTargetExport(ctx, id);
    const jobs = plan.jobs.map((job) => (job.format === "jpeg" ? { ...job, name: job.name.replace(/\.jpe?g$/i, ".png"), format: "png" as const } : job));
    if (jobs.some((job, i) => job !== plan.jobs[i])) {
      issues.push(issue("info", "export.png-instead-of-jpeg", `${id}: JPEG is not available outside the app, images were written as PNG`, `targets[${id}]`));
    }
    const rendered = new Map(jobs.map((job) => [job.name, rasterize(job)]));
    const finished = finishTargetExport({ ...plan, jobs }, rendered, target);
    files.push(...finished.files);
    issues.push(...finished.issues);
  }
  return { files, issues };
}
