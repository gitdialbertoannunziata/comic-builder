import {
  balloonBox,
  compilePageBrief,
  compilePanel,
  pageForTarget,
  resolvePageBoxesForTarget,
  scaleStyles,
  type PanelBrief,
  type CharacterSheet,
  type Scene,
  finishTargetExport,
  findTarget,
  pageFileNames,
  planTargetExport,
  type ExportFile,
  type OutputTarget,
  type Page,
  type SlicePlan,
  type ValidationIssue,
} from "@comic-builder/core";
import { measureWith, type LoadedFont } from "@comic-builder/lettering";
import { primaryGeometry, primaryTarget, project, styles } from "./project.js";
import { embedFont, svgToImageBlob } from "./platform/rasterize.js";

/**
 * Cosa si può esportare: ogni target dichiarato nel progetto, più due uscite
 * che non sono formati di pubblicazione — il documento rieditabile e l'SVG
 * vettoriale della pagina canonica.
 */
export type ExportChoice = { kind: "target"; id: string } | { kind: "document" } | { kind: "svg" } | { kind: "prompts" };

export function choiceKey(choice: ExportChoice): string {
  return choice.kind === "target" ? `target:${choice.id}` : choice.kind;
}

export interface ExportInput {
  pages: readonly Page[];
  chapter: { id: string; title?: string; number?: number };
  /** Per le istruzioni: stile corrente del progetto e scene (luogo e ora di ripiego). */
  projectStyle?: typeof project.style;
  seriesSeed?: number;
  scenes?: readonly Scene[];
  characters?: Readonly<Record<string, CharacterSheet>>;
  font: LoadedFont;
  fontBytes: Uint8Array;
  choices: readonly ExportChoice[];
  /** Il layer bozza (§5.5): spento, un pannello senza arte esce vuoto. */
  draft: boolean;
  /** Arte per pannello come data URI: dentro un'immagine SVG i blob esterni non si caricano. */
  art?: ReadonlyMap<string, string>;
  onProgress?: (message: string) => void;
}

export interface TargetSummary {
  targetId: string;
  label: string;
  files: number;
  slicePlan?: SlicePlan;
}

export interface ExportOutcome {
  files: ExportFile[];
  issues: ValidationIssue[];
  summaries: TargetSummary[];
}

/** Descrizione breve di un target, per chi sceglie cosa esportare: le misure, non l'id. */
export function describeTarget(target: OutputTarget): string {
  switch (target.kind) {
    case "page": {
      const size = target.size_mm
        ? `${target.size_mm[0]}×${target.size_mm[1]} mm a ${target.dpi ?? "?"} dpi`
        : `${target.size_px?.[0]}×${target.size_px?.[1]} px`;
      const bleed = target.bleed_mm ? ` · bleed ${target.bleed_mm} mm` : "";
      const color = target.color === "gray" ? " · grigi" : "";
      return `${size}${bleed}${color} · ${target.format.toUpperCase()}`;
    }
    case "strip":
      return `larga ${target.width_px} px · slice ≤ ${target.slice_max_h} px · ${target.format.toUpperCase()}`;
    case "regions":
      return `regioni dei pannelli di ${target.source}`;
    case "archive":
      return `${target.format.toUpperCase()} delle immagini di ${target.source}`;
  }
}

async function rasterize(job: { svg: string; width: number; height: number; format: "png" | "jpeg"; quality: number }, fontBytes: Uint8Array) {
  const svg = embedFont(job.svg, styles.lettering.font_family, fontBytes);
  const blob = await svgToImageBlob(svg, job.width, job.height, {
    widthPx: job.width,
    format: job.format,
    quality: job.quality,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportChapter(input: ExportInput): Promise<ExportOutcome> {
  const context = {
    project,
    pages: input.pages,
    chapter: input.chapter,
    styles,
    measure: measureWith(input.font),
    draft: input.draft,
    ...(input.art ? { art: input.art } : {}),
  };

  const files: ExportFile[] = [];
  const issues: ValidationIssue[] = [];
  const summaries: TargetSummary[] = [];

  for (const choice of input.choices) {
    if (choice.kind === "document") {
      // Il documento *è* il prodotto (§1): l'unica forma rieditabile della pagina.
      const names = pageFileNames(input.pages, "json");
      input.pages.forEach((page, i) =>
        files.push({ name: `documento/${names[i]!}`, data: JSON.stringify(page, null, 2), mediaType: "application/json" }),
      );
      summaries.push({ targetId: "documento", label: "Documento JSON", files: input.pages.length });
      continue;
    }

    if (choice.kind === "prompts") {
      // Istruzioni per un modello esterno (§9.1), nel formato canonico: le
      // stesse che l'editor mostra pannello per pannello.
      const measure = measureWith(input.font);
      const scaled = scaleStyles(styles, primaryGeometry.letteringScale);
      const all: PanelBrief[] = [];
      const names = pageFileNames(input.pages, "md");
      input.pages.forEach((original, i) => {
        if (original.layout.mode !== "page") return;
        const page = pageForTarget(original, primaryTarget.id);
        const boxes = resolvePageBoxesForTarget(page, primaryGeometry);
        const fits = measure({ page, boxes, lettering: scaled.lettering, draftStyle: scaled.draftStyle, target: primaryTarget.id, draft: false });
        const byId = new Map(page.panels.map((p) => [p.id, p]));
        const order = page.layout.mode === "page" ? page.layout.reading_order : [];
        const briefs = order.flatMap((id) => {
          const panel = byId.get(id);
          const panelBox = boxes.get(id);
          if (!panel || !panelBox) return [];
          const balloonBoxes = panel.balloons.flatMap((b) => {
            const fit = fits.get(b.id);
            return fit ? [{ id: b.id, box: balloonBox(b, panelBox, fit) }] : [];
          });
          const scene = input.scenes?.find((s) => s.id === panel.scene_id);
          return [
            compilePanel({
              project: { style: input.projectStyle ?? project.style, series_seed: input.seriesSeed ?? project.series_seed },
              page,
              panel,
              panelBox,
              balloonBoxes,
              targetId: primaryTarget.id,
              ...(scene ? { scene } : {}),
              ...(input.characters ? { characters: input.characters } : {}),
            }),
          ];
        });
        all.push(...briefs);
        files.push({
          name: `istruzioni/${names[i]!}`,
          data: compilePageBrief({ page, pageBox: { x: 0, y: 0, width: primaryGeometry.width, height: primaryGeometry.height }, panels: briefs, boxes, readingDirection: project.reading_direction }),
          mediaType: "text/markdown",
        });
      });
      files.push({ name: `istruzioni/${input.chapter.id}-prompts.json`, data: JSON.stringify(all, null, 2), mediaType: "application/json" });
      summaries.push({ targetId: "istruzioni", label: "Istruzioni per modelli esterni", files: input.pages.length + 1 });
      continue;
    }

    if (choice.kind === "svg") {
      // Vettoriale della pagina canonica, col font incorporato: si apre ovunque uguale.
      const plan = planTargetExport(context, primaryTarget.id, "svg/");
      for (const job of plan.jobs) {
        files.push({
          name: job.name.replace(/\.(png|jpg)$/, ".svg"),
          data: embedFont(job.svg, styles.lettering.font_family, input.fontBytes),
          mediaType: "image/svg+xml",
        });
      }
      summaries.push({ targetId: "svg", label: "SVG", files: plan.jobs.length });
      continue;
    }

    const target = findTarget(project, choice.id);
    if (!target) continue;
    input.onProgress?.(`${target.id}: preparo…`);
    const plan = planTargetExport(context, target.id);

    const rendered = new Map<string, Uint8Array>();
    for (const [i, job] of plan.jobs.entries()) {
      input.onProgress?.(`${target.id}: immagine ${i + 1} di ${plan.jobs.length}`);
      rendered.set(job.name, await rasterize(job, input.fontBytes));
    }

    const finished = finishTargetExport(plan, rendered, target);
    files.push(...finished.files);
    issues.push(...finished.issues);
    summaries.push({
      targetId: target.id,
      label: target.id,
      files: finished.files.length,
      ...(plan.slicePlan ? { slicePlan: plan.slicePlan } : {}),
    });
  }

  return { files, issues, summaries };
}
