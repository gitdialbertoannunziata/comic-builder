import { z } from "zod";

/** Id stabile e non posizionale (§5.3: "id stabili e non posizionali"). */
export const IdSchema = z.string().min(1);

/** Coordinata normalizzata [0,1], relativa al pannello (§5.6, §5.8 regola 2). */
export const NormalizedCoordSchema = z.number().min(0).max(1);

export const NormalizedPointSchema = z.object({
  x: NormalizedCoordSchema,
  y: NormalizedCoordSchema,
});

export const ReadingDirectionSchema = z.enum(["ltr", "rtl"]);
export type ReadingDirection = z.infer<typeof ReadingDirectionSchema>;

export const TextDirectionSchema = z.enum(["ltr", "rtl"]);
export type TextDirection = z.infer<typeof TextDirectionSchema>;

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * Un'immagine di riferimento curata dall'autore: di un personaggio, di un
 * luogo, dello stile dell'opera. Il modello copia ciò che vede, quindi la
 * curatela è `use`: una scheda raccoglie anche schizzi e prove, e al modello
 * vanno solo quelle spuntate.
 */
export const ReferenceImageSchema = z.object({
  /** Percorso nel progetto, es. `characters/sara/fronte.png`. */
  path: z.string(),
  note: z.string().default(""),
  /** Se va allegata al modello quando si genera. */
  use: z.boolean().default(true),
});
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;

/**
 * Provenienza nello script sorgente (§10.1). Sta fra i primitivi condivisi
 * perché la portano sia il beat (che nasce dallo spoglio) sia il pannello
 * (che nasce dal beat): è la catena che permette di sapere quali pannelli
 * tocca una revisione dello sceneggiatore.
 */
export const SourceRefSchema = z.object({
  file: z.string(),
  from_line: z.number().int().positive(),
  to_line: z.number().int().positive(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
