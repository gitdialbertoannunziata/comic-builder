import { z } from "zod";
import { IdSchema } from "./common.js";

export const ChapterStatusSchema = z.enum(["planned", "scripting", "in-production", "done"]);

export const ChapterSchema = z.object({
  id: IdSchema,
  number: z.number().int().positive(),
  title: z.string(),
  status: ChapterStatusSchema,
  due: z.string().nullable().optional(),
  /** Ordine di lettura delle pagine (§5.3): inserire/rinumerare pagine è normale. */
  pages: z.array(IdSchema).default([]),
  /**
   * Indice più alto mai assegnato a un pagina del capitolo. Gli id non si riusano (§5.3):
   * senza questo contatore, cancellare l'ultimo la pagina e crearne uno nuovo ne
   * riprodurrebbe l'id, e una voce di changelog scritta per il vecchio
   * finirebbe sul nuovo (§10.2). Assente nei documenti vecchi: vale il massimo presente.
   */
  page_seq: z.number().int().nonnegative().optional(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ChaptersDocSchema = z.object({
  schema: z.literal(1),
  chapters: z.array(ChapterSchema),
});
export type ChaptersDoc = z.infer<typeof ChaptersDocSchema>;
