import type { Box } from "../layout/resolveLayout.js";
import type { Page } from "../schema/page.js";
import type { DraftStyle, LetteringConfig, OutputTarget, PageTarget, Project, StripTarget } from "../schema/project.js";
import type { LetteringFit } from "../render/types.js";
import { renderEpisodeStripSvg, renderPageSvg } from "../render/renderSvg.js";
import type { ExportFile } from "../platform/platformService.js";
import { pageFileNames } from "../platform/exportNames.js";
import { issue, type ValidationIssue } from "../validate/issue.js";
import { createCbz } from "../package/cbz.js";
import { findTarget, resolvePageTargetGeometry, type PageTargetGeometry } from "./geometry.js";
import { pageForTarget, pageRenderConfig, resolvePageBoxesForTarget, scaleStyles, type TargetStyles } from "./pageTarget.js";
import { pageRegions, type PageRegions } from "./regions.js";
import { resolveEpisodeStrip, stripObstacles } from "./strip.js";
import { sliceStrip, type SlicePlan } from "./slice.js";

/**
 * Pianificazione dell'export di un capitolo verso un target (§4, F2.1).
 *
 * Tutto quello che si può decidere senza pixel si decide qui: geometria,
 * re-layout, lettering alla scala giusta, tagli della striscia, regioni,
 * nomi dei file. Restano fuori due cose che il Core non può fare (§11.2): la
 * misura dei glifi, che arriva iniettata come `measure`, e la
 * rasterizzazione, che fa l'host (canvas nel browser, resvg in Node). Il
 * risultato è identico sui due host perché la parte che decide è questa.
 */

export type MeasureFits = (input: {
  page: Page;
  boxes: Map<string, Box>;
  lettering: LetteringConfig;
  draftStyle: DraftStyle;
  target: string;
  draft: boolean;
}) => Map<string, LetteringFit>;

export type ImageFormat = "png" | "jpeg";

/** Un'immagine da rasterizzare: SVG pronto, dimensioni finali, formato. */
export interface RenderJob {
  name: string;
  svg: string;
  width: number;
  height: number;
  format: ImageFormat;
  /** Qualità in [0,1], per JPEG. */
  quality: number;
  pageId: string | null;
}

export interface TargetExportPlan {
  targetId: string;
  kind: OutputTarget["kind"];
  jobs: RenderJob[];
  /** File già pronti, senza rasterizzazione (regioni, documenti). */
  files: ExportFile[];
  issues: ValidationIssue[];
  slicePlan?: SlicePlan;
  /** Per un target archivio: le immagini dei job finiscono in un CBZ. */
  archive?: { name: string; info: Parameters<typeof createCbz>[1] };
}

export interface ExportContext {
  project: Pick<Project, "id" | "title" | "locale" | "reading_direction" | "targets" | "page">;
  /** Pagine del capitolo, in qualunque ordine: vale `page.order`. */
  pages: readonly Page[];
  chapter: { id: string; number?: number; title?: string };
  styles: TargetStyles;
  measure: MeasureFits;
  /** Il layer bozza nell'export: di norma spento (§5.5). */
  draft?: boolean;
  /**
   * Arte per pannello, già in una forma che il rasterizzatore sa leggere
   * (data URI nel browser, percorso o data URI in Node). Un pannello che
   * dichiara arte assente da qui è un errore d'export, non un pannello vuoto.
   */
  art?: ReadonlyMap<string, string>;
}

function missingArtIssues(ctx: ExportContext, pages: readonly Page[], targetId: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const page of pages) {
    for (const panel of page.panels) {
      if (panel.art.source && !ctx.art?.has(panel.id)) {
        issues.push(issue("error", "export.missing-art", `${panel.id}: l'arte ${panel.art.source} non è stata trovata`, `targets[${targetId}].${panel.id}`));
      }
    }
  }
  return issues;
}

function extension(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : "png";
}

function primaryPageTarget(project: ExportContext["project"]): PageTarget {
  const pages = project.targets.filter((t): t is PageTarget => t.kind === "page");
  const primary = pages.find((t) => t.primary) ?? pages[0];
  if (!primary) throw new Error("Il progetto non dichiara nessun target pagina.");
  return primary;
}

function byOrder(pages: readonly Page[]): Page[] {
  return [...pages].sort((a, b) => a.order - b.order);
}

function planPages(ctx: ExportContext, target: PageTarget, folder: string): TargetExportPlan {
  const geometry = resolvePageTargetGeometry(target, ctx.project);
  const styles = scaleStyles(ctx.styles, geometry.letteringScale);
  const pages = byOrder(ctx.pages).filter((p) => p.layout.mode === "page");
  const names = pageFileNames(pages, extension(target.format));
  const draft = ctx.draft ?? false;
  const primary = primaryPageTarget(ctx.project);

  const jobs = pages.map((original, i): RenderJob => {
    const page = pageForTarget(original, target.id);
    const boxes = resolvePageBoxesForTarget(page, geometry);
    // L'arte si cerca sotto il target stesso e, in mancanza, sotto il canonico:
    // una tavola disegnata per il digitale è la stessa tavola in stampa.
    const artTarget = page.panels.some((p) => p.render[target.id]) ? target.id : primary.id;
    const fits = ctx.measure({ page, boxes, lettering: styles.lettering, draftStyle: styles.draftStyle, target: artTarget, draft });
    const config = { ...pageRenderConfig(geometry, styles, { draft, artTarget }), ...(ctx.art ? { art: ctx.art } : {}) };
    return {
      name: `${folder}${names[i]!}`,
      svg: renderPageSvg(page, boxes, fits, config),
      width: geometry.width,
      height: geometry.height,
      format: target.format,
      quality: target.quality,
      pageId: page.id,
    };
  });

  return { targetId: target.id, kind: "page", jobs, files: [], issues: missingArtIssues(ctx, pages, target.id) };
}

function planRegions(ctx: ExportContext, target: Extract<OutputTarget, { kind: "regions" }>, folder: string): TargetExportPlan {
  const source = findTarget(ctx.project, target.source);
  if (!source || source.kind !== "page") {
    return {
      targetId: target.id,
      kind: "regions",
      jobs: [],
      files: [],
      issues: [issue("error", "target.bad-source", `"${target.id}" richiede un target pagina come sorgente`, `targets[${target.id}]`)],
    };
  }
  const geometry: PageTargetGeometry = resolvePageTargetGeometry(source, ctx.project);
  const pages = byOrder(ctx.pages).filter((p) => p.layout.mode === "page");
  const images = pageFileNames(pages, extension(source.format));
  const regions: PageRegions[] = pages.map((page, i) =>
    pageRegions(page, resolvePageBoxesForTarget(page, geometry), geometry, `${source.id}/${images[i]!}`, source.reading_direction),
  );

  const doc = {
    schema: 1,
    target: target.id,
    source: source.id,
    chapter: ctx.chapter.id,
    // Dichiarato nel file, così chi lo converte per una piattaforma non deve indovinare.
    coordinates: "normalized-to-trim",
    pages: regions,
  };
  return {
    targetId: target.id,
    kind: "regions",
    jobs: [],
    files: [{ name: `${folder}${ctx.chapter.id}-regions.json`, data: JSON.stringify(doc, null, 2), mediaType: "application/json" }],
    issues: [],
  };
}

function planStrip(ctx: ExportContext, target: StripTarget, folder: string): TargetExportPlan {
  const canonical = resolvePageTargetGeometry(primaryPageTarget(ctx.project), ctx.project);
  const pages = byOrder(ctx.pages).filter((p) => p.layout.mode === "page").map((p) => pageForTarget(p, target.id));
  const strip = resolveEpisodeStrip(pages, target, canonical);
  const styles = scaleStyles(ctx.styles, strip.letteringScale);
  const draft = ctx.draft ?? false;
  const primary = primaryPageTarget(ctx.project);

  // Il lettering si misura sui box della striscia, non su quelli della pagina:
  // un pannello largo un terzo di pagina qui è largo quanto la striscia.
  const fits = new Map<string, LetteringFit>();
  for (const page of pages) {
    const boxes = new Map<string, Box>();
    for (const placement of strip.placements) if (placement.pageId === page.id) boxes.set(placement.panel.id, placement.box);
    const measured = ctx.measure({ page, boxes, lettering: styles.lettering, draftStyle: styles.draftStyle, target: primary.id, draft });
    for (const [id, fit] of measured) fits.set(id, fit);
  }

  const plan = sliceStrip(strip, stripObstacles(strip, fits), {
    maxHeight: target.slice_max_h,
    minHeight: target.slice_min_h ?? target.slice_max_h / 2,
    overlapPx: target.overlap_px,
  });

  const issues: ValidationIssue[] = missingArtIssues(ctx, pages, target.id);
  for (const cut of plan.cuts) {
    const path = `targets[${target.id}].cuts[${cut.y}]`;
    if (cut.kind === "obstacle") {
      const what = cut.crosses.map((o) => (o.kind === "balloon" ? `balloon ${o.id}` : `banda del pannello ${o.id}`)).join(", ");
      issues.push(issue("error", "slice.through-obstacle", `Taglio a ${cut.y}px attraverso ${what}: più alto di una slice, va spostato o ridotto`, path));
    } else if (cut.kind === "panel") {
      issues.push(issue("warning", "slice.inside-panel", `Taglio a ${cut.y}px dentro un pannello (pagina ${cut.pageId ?? "?"}): controlla che non attraversi un volto`, path));
    }
  }
  if (target.limits.max_images !== undefined && plan.slices.length > target.limits.max_images) {
    issues.push(
      issue("error", "slice.too-many-images", `${plan.slices.length} immagini, la piattaforma ne accetta ${target.limits.max_images}`, `targets[${target.id}]`),
    );
  }

  // Un solo disegno per tutta la striscia; ogni slice ne è una finestra.
  const stripGeometry: PageTargetGeometry = {
    targetId: target.id,
    width: strip.width,
    height: strip.height,
    bleed: 0,
    trim: { x: 0, y: 0, width: strip.width, height: strip.height },
    content: { x: 0, y: 0, width: strip.width, height: strip.height },
    scale: strip.width / canonical.trim.width,
    letteringScale: strip.letteringScale,
    color: "srgb",
  };
  const stripConfig = { ...pageRenderConfig(stripGeometry, styles, { draft, artTarget: primary.id }), ...(ctx.art ? { art: ctx.art } : {}) };

  const width = Math.max(3, String(plan.slices.length).length);
  const ext = extension(target.format);
  const jobs = plan.slices.map((slice): RenderJob => {
    const viewport = { x: 0, y: slice.y, width: strip.width, height: slice.imageHeight };
    const config = { ...stripConfig, viewport };
    return {
      name: `${folder}${ctx.chapter.id}-${String(slice.index + 1).padStart(width, "0")}.${ext}`,
      svg: renderEpisodeStripSvg(strip.placements, fits, config),
      width: strip.width,
      height: slice.imageHeight,
      format: target.format,
      quality: target.quality,
      pageId: null,
    };
  });

  const report = {
    target: target.id,
    chapter: ctx.chapter.id,
    height: strip.height,
    slices: plan.slices,
    cuts: plan.cuts.map((c) => ({ y: c.y, kind: c.kind, page: c.pageId, crosses: c.crosses.map((o) => o.id) })),
    report: plan.report,
  };

  return {
    targetId: target.id,
    kind: "strip",
    jobs,
    files: [{ name: `${folder}${ctx.chapter.id}-slicing.json`, data: JSON.stringify(report, null, 2), mediaType: "application/json" }],
    issues,
    slicePlan: plan,
  };
}

/** Pianifica l'export di un target. `folder` antepone una cartella ai nomi, di default l'id del target. */
export function planTargetExport(ctx: ExportContext, targetId: string, folder = `${targetId}/`): TargetExportPlan {
  const target = findTarget(ctx.project, targetId);
  if (!target) throw new Error(`Target "${targetId}" non dichiarato nel progetto.`);

  switch (target.kind) {
    case "page":
      return planPages(ctx, target, folder);
    case "strip":
      return planStrip(ctx, target, folder);
    case "regions":
      return planRegions(ctx, target, folder);
    case "archive": {
      const source = findTarget(ctx.project, target.source);
      if (!source || (source.kind !== "page" && source.kind !== "strip")) {
        return {
          targetId: target.id,
          kind: "archive",
          jobs: [],
          files: [],
          issues: [issue("error", "target.bad-source", `"${target.id}" richiede un target pagina o striscia come sorgente`, `targets[${target.id}]`)],
        };
      }
      // Dentro l'archivio le immagini stanno alla radice: i lettori CBZ non
      // si aspettano cartelle.
      const inner = planTargetExport(ctx, source.id, "");
      const language = ctx.project.locale.split("-")[0];
      return {
        ...inner,
        targetId: target.id,
        kind: "archive",
        files: [],
        archive: {
          name: `${folder}${ctx.chapter.id}.cbz`,
          info: {
            title: ctx.chapter.title ?? ctx.chapter.id,
            series: ctx.project.title,
            ...(ctx.chapter.number !== undefined ? { number: String(ctx.chapter.number) } : {}),
            ...(language ? { languageIso: language } : {}),
            readingDirection: source.kind === "page" ? source.reading_direction : ctx.project.reading_direction,
          },
        },
      };
    }
  }
}

/**
 * Dall'esito della rasterizzazione ai file da scrivere. `rendered` associa il
 * nome di ogni job ai suoi byte. Qui si impacchetta il CBZ e si controllano i
 * limiti di peso della piattaforma, che si conoscono solo a immagini fatte.
 */
export function finishTargetExport(
  plan: TargetExportPlan,
  rendered: ReadonlyMap<string, Uint8Array>,
  target?: OutputTarget,
): { files: ExportFile[]; issues: ValidationIssue[] } {
  const issues = [...plan.issues];
  const images = plan.jobs.map((job) => {
    const data = rendered.get(job.name);
    if (!data) throw new Error(`Manca l'immagine rasterizzata di "${job.name}".`);
    return { job, data };
  });

  if (target?.kind === "strip") {
    const { max_bytes_per_image, max_bytes_total } = target.limits;
    let total = 0;
    for (const { job, data } of images) {
      total += data.length;
      if (max_bytes_per_image !== undefined && data.length > max_bytes_per_image) {
        issues.push(issue("error", "export.image-too-heavy", `${job.name}: ${data.length} byte, limite ${max_bytes_per_image}`, `targets[${target.id}]`));
      }
    }
    if (max_bytes_total !== undefined && total > max_bytes_total) {
      issues.push(issue("error", "export.episode-too-heavy", `Episodio di ${total} byte, limite ${max_bytes_total}`, `targets[${target.id}]`));
    }
  }

  if (plan.archive) {
    const cbz = createCbz(
      images.map(({ job, data }) => ({ name: job.name, data })),
      plan.archive.info,
    );
    return { files: [{ name: plan.archive.name, data: cbz, mediaType: "application/vnd.comicbook+zip" }], issues };
  }

  const mediaType = (format: ImageFormat) => (format === "jpeg" ? "image/jpeg" : "image/png");
  return {
    files: [...images.map(({ job, data }) => ({ name: job.name, data, mediaType: mediaType(job.format) })), ...plan.files],
    issues,
  };
}
