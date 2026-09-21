import { z } from "zod";
import { IdSchema, ReadingDirectionSchema, TextDirectionSchema } from "./common.js";
import { BalloonTypeSchema } from "./balloon.js";

/**
 * Formato e compressione dell'immagine esportata. Stanno sul target e non nel
 * codice di export (Appendice C, regola 3): aggiungere o cambiare un formato
 * d'uscita è una voce di configurazione.
 */
const ImageFormatSchema = z.enum(["png", "jpeg"]);

/**
 * Moltiplicatore del corpo del lettering per questo target, oltre alla scala
 * naturale in unità di pagina (§8.1). Serve dove la larghezza d'uscita non
 * racconta come verrà letta: una striscia larga 1080 px si guarda su un
 * telefono, e il testo scalato solo per larghezza vi risulterebbe minuscolo.
 */
const LetteringScaleSchema = z.number().positive().default(1);

const PageTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("page"),
  size_px: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  size_mm: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  dpi: z.number().positive().optional(),
  bleed_mm: z.number().nonnegative().optional(),
  /**
   * Rientro dell'area sicura dal taglio, per la stampa (Appendice C). Si somma
   * al bleed nel canvas e fa da minimo per i margini: nessun pannello finisce
   * nella fascia che il taglio può mangiare.
   */
  safe_mm: z.number().nonnegative().optional(),
  color: z.enum(["srgb", "gray", "cmyk"]).default("srgb"),
  reading_direction: ReadingDirectionSchema,
  format: ImageFormatSchema.default("png"),
  /** Qualità JPEG in [0,1]; ignorata per PNG. */
  quality: z.number().min(0).max(1).default(0.92),
  lettering_scale: LetteringScaleSchema,
  primary: z.boolean().default(false),
});
export type PageTarget = z.infer<typeof PageTargetSchema>;

/** Limiti imposti dalla piattaforma a un episodio (Appendice C): da configurare, cambiano senza preavviso. */
export const PlatformLimitsSchema = z.object({
  max_images: z.number().int().positive().optional(),
  max_bytes_per_image: z.number().int().positive().optional(),
  max_bytes_total: z.number().int().positive().optional(),
});
export type PlatformLimits = z.infer<typeof PlatformLimitsSchema>;

const StripTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("strip"),
  width_px: z.number().positive(),
  slice_max_h: z.number().positive(),
  /** Altezza minima di una slice (§7.2); l'ultima dell'episodio può essere più bassa. */
  slice_min_h: z.number().positive().optional(),
  seam: z.enum(["none", "visible"]).default("none"),
  /**
   * Altezza massima di un pannello nella striscia; default `slice_max_h`. Un
   * pannello che la supererebbe a tutta larghezza si restringe e si centra:
   * altrimenti un pannello stretto della pagina diventa alto più di una slice,
   * e ogni taglio finisce dentro l'arte.
   */
  panel_max_h: z.number().positive().optional(),
  /** Pixel ripetuti in fondo a ogni slice, per chi impila le immagini sovrapponendole (§7.2). */
  overlap_px: z.number().nonnegative().default(0),
  /** Spazio fra pannelli e fra pagine nella striscia: 0 è la norma, le giunzioni non si vedono (§7.2). */
  panel_gap: z.number().nonnegative().default(0),
  page_gap: z.number().nonnegative().default(0),
  format: ImageFormatSchema.default("jpeg"),
  quality: z.number().min(0).max(1).default(0.9),
  /** Default 2: una striscia si legge su un telefono (vedi `LetteringScaleSchema`). */
  lettering_scale: z.number().positive().default(2),
  limits: PlatformLimitsSchema.default({}),
  primary: z.boolean().default(false),
});
export type StripTarget = z.infer<typeof StripTargetSchema>;

const RegionsTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("regions"),
  source: z.string(),
  primary: z.boolean().default(false),
});
export type RegionsTarget = z.infer<typeof RegionsTargetSchema>;

/**
 * Contenitore (§4, `cbz`): un archivio delle immagini di un altro target,
 * con numerazione di pagina nell'ordine di lettura. Non rende nulla da sé.
 */
const ArchiveTargetSchema = z.object({
  id: z.string(),
  kind: z.literal("archive"),
  format: z.enum(["cbz"]).default("cbz"),
  source: z.string(),
  primary: z.boolean().default(false),
});
export type ArchiveTarget = z.infer<typeof ArchiveTargetSchema>;

/** Il formato è un asse di render (§4): ogni target è dato di configurazione, non codice cablato. */
export const OutputTargetSchema = z.discriminatedUnion("kind", [
  PageTargetSchema,
  StripTargetSchema,
  RegionsTargetSchema,
  ArchiveTargetSchema,
]);
export type OutputTarget = z.infer<typeof OutputTargetSchema>;

export const MarginSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});
export type Margin = z.infer<typeof MarginSchema>;

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
  /**
   * Le regole della serie, in chiaro: ciò che deve restare uguale da un
   * capitolo all'altro e che lo spoglio deve rispettare — tono, ritmo, quante
   * battute per vignetta, preferenze di inquadratura, come parla un
   * personaggio. Arrivano al modello come istruzioni, a ogni capitolo.
   */
  series_notes: z.string().default(""),
  fonts: z.array(FontDeclarationSchema).default([]),
  chapters: z.string(),
  scenes: z.string(),
  app_version: z.string(),
  created: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;
