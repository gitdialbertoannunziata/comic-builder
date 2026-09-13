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
export const TextDirectionSchema = z.enum(["ltr", "rtl"]);

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
