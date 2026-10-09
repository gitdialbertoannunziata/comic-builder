import { z } from "zod";
import { IdSchema, ReferenceImageSchema } from "./common.js";

/**
 * Scheda di un luogo (`locations/<ref>.json`), come quella di un personaggio.
 *
 * Una scena dice *dove* («La stanza»), non *com'è*: senza una scheda il
 * modello riceve due parole e ogni vignetta reinventa il posto — la
 * finestra cambia lato, la scrivania cambia forma. La scheda dice com'è
 * fatto una volta per la serie, e le sue immagini spuntate si allegano a
 * ogni vignetta ambientata lì.
 *
 * Il ref deriva dal nome che le scene usano (`locationRef`): lo spoglio
 * riusa lo stesso nome fra un capitolo e l'altro, e così ritrova la scheda.
 */
export const LocationSheetSchema = z.object({
  schema: z.literal(1),
  id: IdSchema,
  /** Il nome come lo scrivono le scene: «La stanza». */
  name: z.string().default(""),
  /**
   * Com'è fatto, in frasi brevi da scheda: pianta, arredi, materiali, colori,
   * da dove viene la luce. L'ora del giorno no: quella è della scena.
   */
  description: z.string().default(""),
  /** Colori ricorrenti del luogo. */
  palette: z.string().default(""),
  references: z.array(ReferenceImageSchema).default([]),
});
export type LocationSheet = z.infer<typeof LocationSheetSchema>;
