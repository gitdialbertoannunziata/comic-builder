import { z } from "zod";
import { IdSchema } from "./common.js";
import { PanelSchema } from "./panel.js";
import { BalloonSchema } from "./balloon.js";

export const GutterSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
});

export const VariantStatusSchema = z.enum(["derived", "tuned"]);

/** Politica di slicing pagina → striscia (§7.2): mai a metà di un balloon. */
export const SlicePolicySchema = z.object({
  max_height: z.number().positive(),
  min_height: z.number().positive(),
  seam: z.enum(["none", "visible"]),
  avoid: z.array(z.enum(["balloons", "faces"])).default(["balloons"]),
  prefer: z.enum(["gutter"]).default("gutter"),
  overlap_px: z.number().nonnegative().default(0),
});
export type SlicePolicy = z.infer<typeof SlicePolicySchema>;

export const PageVariantSchema = z.object({
  status: VariantStatusSchema,
  slice: SlicePolicySchema.optional(),
  balloon_overrides: z.array(z.string()).default([]),
});
export type PageVariant = z.infer<typeof PageVariantSchema>;

/** Modalità `page` (§7.1): tracce + aree, non righe partizionate. */
export const PageLayoutSchema = z.object({
  mode: z.literal("page"),
  primary_target: z.string(),
  template_id: z.string().optional(),
  /** Pesi `fr` delle tracce; i box in px non si salvano mai (§5.8 regola 2). */
  cols: z.array(z.number().positive()).min(1),
  rows: z.array(z.number().positive()).min(1),
  gutter: GutterSchema,
  /** Permutazione completa e senza duplicati degli id pannello (validato da validateDocument). */
  reading_order: z.array(IdSchema),
});
export type PageLayout = z.infer<typeof PageLayoutSchema>;

/** Modalità `strip` (§7.2): sequenza verticale, caso particolare della griglia. */
export const StripLayoutSchema = z.object({
  mode: z.literal("strip"),
  width_ratio: z.number().positive().default(1),
  panel_gap: z.number().nonnegative().default(0),
  sequence: z.array(IdSchema),
});
export type StripLayout = z.infer<typeof StripLayoutSchema>;

export const LayoutSchema = z.discriminatedUnion("mode", [PageLayoutSchema, StripLayoutSchema]);
export type Layout = z.infer<typeof LayoutSchema>;

export const PageSchema = z.object({
  schema: z.literal(1),
  id: IdSchema,
  chapter_id: IdSchema,
  order: z.number().int().nonnegative(),
  spread_with: IdSchema.nullable().default(null),
  layout: LayoutSchema,
  variants: z.record(z.string(), PageVariantSchema).default({}),
  panels: z.array(PanelSchema).default([]),
  /** Balloon/cartigli a livello di pagina, per ciò che le ancore al pannello non esprimono (§5.4). */
  overlays: z.array(BalloonSchema).default([]),
});
export type Page = z.infer<typeof PageSchema>;
