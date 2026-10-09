import type { StyleConfig } from "../schema/project.js";

/**
 * Stili di partenza. Uno stile scritto bene è il pezzo di prompt che più
 * tiene insieme un capitolo, ed è anche il più difficile da scrivere da zero:
 * questi sono punti di partenza da correggere, non un catalogo chiuso.
 *
 * In inglese, perché è la lingua in cui il modello lo legge meglio. Tutti
 * dicono «disegnato a mano» e «2D» in positivo invece di elencare ciò che
 * non si vuole (foto, 3D): FLUX.2 non ha un prompt negativo, e nominare una
 * cosa per escluderla è il modo più sicuro di vedersela disegnata.
 */
export interface StylePreset {
  id: string;
  label: string;
  /** Per chi sceglie: a cosa somiglia. */
  hint: string;
  positive: string;
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "ink-flat",
    label: "Linea chiara",
    hint: "contorni neri uniformi, colori piatti, sfondi precisi",
    positive:
      "hand-drawn 2D European comic art in the ligne claire tradition, clean uniform black ink outlines, flat colours without gradients, simple cel shadows, detailed readable backgrounds, consistent character proportions",
  },
  {
    id: "noir-ink",
    label: "Noir a china",
    hint: "bianco e nero, neri pieni, contrasti forti",
    positive:
      "hand-drawn 2D black and white comic art, bold brush inking, large areas of solid black, high-contrast chiaroscuro lighting, no grey tones, crisp white highlights",
  },
  {
    id: "manga-bw",
    label: "Manga in bianco e nero",
    hint: "pennino, retini, espressioni marcate",
    positive:
      "hand-drawn 2D black and white manga art, crisp pen lines of varying weight, screentone shading, expressive faces, clean white backgrounds where the scene allows",
  },
  {
    id: "graphic-novel-wash",
    label: "Graphic novel ad acquerello",
    hint: "china e acquerello, palette terrosa, carta",
    positive:
      "hand-drawn 2D graphic novel illustration, loose ink line art with watercolour washes, muted earthy palette, visible paper texture, soft natural shadows",
  },
  {
    id: "satirical-grotesque",
    label: "Satira grottesca",
    hint: "caricatura, tratteggio nervoso, colori acidi e spenti",
    positive:
      "hand-drawn 2D satirical underground comic art, exaggerated grotesque caricature, scratchy pen hatching and cross-hatching, wobbly expressive lines, muted sickly palette of greys, olive greens and dirty yellows",
  },
  {
    id: "webtoon-colour",
    label: "Webtoon a colori",
    hint: "linee pulite digitali, ombre morbide, colori vivi",
    positive:
      "2D digital webtoon comic art, clean thin lineart, soft cel shading, vibrant flat colours, smooth simple gradients only in skies and lights",
  },
];

/**
 * Lo stile come va nel prompt: quello scritto dall'autore; se non ne ha
 * scritto uno, quello del preset del progetto. Mai vuoto: senza uno stile
 * ogni vignetta ne sceglie uno suo — foto, cartoon, pittura — e il capitolo
 * sembra un collage. Uno stile qualunque, uguale per tutti, è già meglio.
 */
export function styleText(style: Pick<StyleConfig, "positive" | "preset">): string {
  const written = style.positive.map((s) => s.trim()).filter(Boolean).join(", ");
  if (written) return written.replace(/[.;]+$/, "");
  return (STYLE_PRESETS.find((p) => p.id === style.preset) ?? STYLE_PRESETS[0]!).positive;
}

/** Vero se lo stile l'ha scelto l'autore, non è il ripiego. */
export function styleChosen(style: Pick<StyleConfig, "positive">): boolean {
  return style.positive.some((s) => s.trim().length > 0);
}
