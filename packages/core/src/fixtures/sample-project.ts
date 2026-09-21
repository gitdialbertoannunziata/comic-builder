import { ProjectSchema, type Project } from "../schema/project.js";

/**
 * Progetto d'esempio con i target di §5.2 e un archivio CBZ (Appendice C).
 * I valori di piattaforma sono quelli indicativi del piano: in un progetto
 * vero si correggono qui, non nel codice (Appendice C, regola 3).
 */
export const sampleProject: Project = ProjectSchema.parse({
  schema: 1,
  id: "sample-series",
  title: "Il faro di Capo Vento",
  locale: "it-IT",
  text_direction: "ltr",
  reading_direction: "ltr",
  series_seed: 20260913,
  targets: [
    { id: "digital-page", kind: "page", size_px: [1600, 2400], color: "srgb", reading_direction: "ltr", format: "png", primary: true },
    {
      id: "print-b5",
      kind: "page",
      size_mm: [182, 257],
      dpi: 600,
      bleed_mm: 3,
      safe_mm: 5,
      color: "gray",
      reading_direction: "ltr",
      format: "png",
    },
    {
      id: "webtoon-strip",
      kind: "strip",
      width_px: 1080,
      slice_max_h: 1280,
      slice_min_h: 640,
      seam: "none",
      format: "jpeg",
      limits: { max_images: 100, max_bytes_per_image: 2_000_000, max_bytes_total: 20_000_000 },
    },
    { id: "guided-view", kind: "regions", source: "digital-page" },
    { id: "cbz", kind: "archive", format: "cbz", source: "digital-page" },
  ],
  page: { margin: { top: 56, right: 56, bottom: 56, left: 56 } },
  lettering: { font_family: "Comic Neue", base_size_px: 26, line_height: 1.35, padding: 12, max_width_ratio: 0.62, tail_width: 10 },
  style: { preset: "ink-flat", positive: [], negative: [] },
  chapters: "chapters.json",
  scenes: "scenes.json",
  app_version: "0.1.0",
  created: "2026-09-13T00:00:00Z",
});
