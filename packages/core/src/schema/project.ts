import { z } from "zod";
import { IdSchema, ReadingDirectionSchema, TextDirectionSchema } from "./common.js";
import { BalloonTypeSchema } from "./balloon.js";

const PageTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("page"),
  size_px: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  size_mm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  dpi: z.number().positive().optional(),
  bleed_mm: z.number().nonnegative().optional(),
  color: z.enum(["srgb", "gray", "cmyk"]).default("srgb"),
  reading_direction: ReadingDirectionSchema,
  primary: z.boolean().default(false),
});

const StripTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("strip"),
  width_px: z.number().positive(),
  slice_max_h: z.number().positive(),
  seam: z.enum(["none", "visible"]).default("none"),
  format: z.enum(["jpeg", "png"]).default("jpeg"),
  primary: z.boolean().default(false),
});

const RegionsTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("regions"),
  source: z.string(),
  primary: z.boolean().default(false),
});

/** Il formato è un asse di render (§4): ogni target è dato di configurazione, non codice cablato. */
export const OutputTargetSchema = z.discriminatedUnion("kind", [
  PageTargetSchema,
  StripTargetSchema,
  RegionsTargetSchema,
]);
export type OutputTarget = z.infer<typeof OutputTargetSchema>;

export const MarginSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});

/** Dimensioni in unità di pagina (§8.1): non di pannello, per coerenza fra pannelli di dimensioni diverse. */
export const LetteringConfigSchema = z.object({
  font_family: z.string(),
  base_size_px: z.number().positive(),
  line_height: z.number().positive(),
  padding: z.number().nonnegative(),
  max_width_ratio: z.number().positive().max(1),
  tail_width: z.number().positive(),
  /**
   * Margine oltre il `padding`, come frazione di `fontSizePx` per lato: assorbe
   * lo scarto fra il testo misurato come riga unica e il render, che lo spezza
   * in più `<tspan>` ai confini dell'enfasi — la maggior parte dei motori SVG
   * non applica il kerning fra `<tspan>` diversi (verificato con resvg). Non
   * un dettaglio nascosto del renderer: dichiarato qui con un default, come
   * gli altri parametri del lettering (§5.2).
   */
  safety_margin_ratio: z.number().min(0).max(1).default(0.15),
});
export type LetteringConfig = z.infer<typeof LetteringConfigSchema>;

export const StyleConfigSchema = z.object({
  preset: z.string(),
  positive: z.array(z.string()).default([]),
  negative: z.array(z.string()).default([]),
});

/** Aspetto grafico di un balloon: stroke, riempimento, raggio degli angoli, tratteggio. */
export const BalloonVisualStyleSchema = z.object({
  stroke: z.string().default("black"),
  stroke_width: z.number().nonnegative().default(2),
  fill: z.string().default("white"),
  /** Capato a metà altezza dal renderer, come oggi: qui è il raggio "a riposo". */
  corner_radius_px: z.number().nonnegative().default(18),
  /** `stroke-dasharray` SVG, o null per un contorno pieno. */
  dash: z.string().nullable().default(null),
});
export type BalloonVisualStyle = z.infer<typeof BalloonVisualStyleSchema>;

/**
 * Stile grafico dei balloon (§8.2): uno stile di base più override per i tipi
 * enum-chiusi di `BalloonTypeSchema` — stessa precedenza progetto→pannello già
 * usata per lo stile dell'arte (§9.1), applicata qui al solo livello progetto.
 * Dichiarato in project.json, non costanti nascoste nel renderer: chi vuole un
 * altro tratto (più spesso, un altro colore, tratteggi diversi) lo cambia qui.
 */
export const BalloonStyleSchema = z.object({
  base: BalloonVisualStyleSchema.default({}),
  by_type: z
    .record(BalloonTypeSchema, BalloonVisualStyleSchema.partial())
    .default({
      whisper: { dash: "6 4" },
      thought: { dash: "2 4" },
      shout: { stroke_width: 4 },
      caption: { corner_radius_px: 4 },
    }),
});
export type BalloonStyle = z.infer<typeof BalloonStyleSchema>;

/**
 * Aspetto del layer bozza: quello che un pannello disegna finché non ha arte
 * (§5.5, §6.2 — "per chi disegna, la camera è la specifica di disegno").
 * Non è un segnaposto: è il foglio di spoglio da cui l'autore disegna, e
 * sparisce da solo appena l'arte entra nel pannello.
 */
export const DraftStyleSchema = z.object({
  /** Fondo del pannello non ancora disegnato: dice "qui manca l'arte" senza urlare. */
  background: z.string().default("#f4f4f2"),
  /** Testo dell'azione — è il contenuto, quindi il più leggibile dei tre. */
  ink: z.string().default("#1b1b1b"),
  /** Annotazioni di servizio: badge della camera, elenco personaggi. */
  muted: z.string().default("#7a7a75"),
  /** Corpo del testo dell'azione, in frazione di `lettering.base_size_px`. */
  action_size_ratio: z.number().positive().default(0.85),
  /** Corpo delle annotazioni di servizio, in frazione di `lettering.base_size_px`. */
  annotation_size_ratio: z.number().positive().default(0.6),
  padding: z.number().nonnegative().default(14),
});
export type DraftStyle = z.infer<typeof DraftStyleSchema>;

export const FontDeclarationSchema = z.object({
  family: z.string(),
  path: z.string(),
  license: z.string(),
  scope: z.enum(["dialogue", "caption", "sfx"]),
});
export type FontDeclaration = z.infer<typeof FontDeclarationSchema>;

export const ProjectSchema = z.object({
  schema: z.literal(1),
  id: IdSchema,
  title: z.string(),
  locale: z.string(),
  text_direction: TextDirectionSchema,
  reading_direction: ReadingDirectionSchema,
  series_seed: z.number().int(),
  targets: z.array(OutputTargetSchema).min(1),
  page: z.object({ margin: MarginSchema }),
  lettering: LetteringConfigSchema,
  style: StyleConfigSchema,
  balloon_style: BalloonStyleSchema.default({}),
  draft_style: DraftStyleSchema.default({}),
  fonts: z.array(FontDeclarationSchema).default([]),
  chapters: z.string(),
  scenes: z.string(),
  app_version: z.string(),
  created: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;
