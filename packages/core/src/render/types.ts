import type { Emphasis } from "../schema/balloon.js";
import type { BalloonStyle, DraftStyle } from "../schema/project.js";

/**
 * Risultato del fitting testo di un balloon, calcolato a monte (dal pacchetto
 * lettering, che misura i glifi reali via opentype.js). Il renderer del Core
 * consuma solo questa forma di dati — mai il font stesso — per non reintrodurre
 * una dipendenza da opentype.js nel Core (§11.2: unica dipendenza, zod).
 */
export interface LetteringFit {
  lines: Array<Array<{ text: string; em?: Emphasis | undefined }>>;
  fontSizePx: number;
  /** Altezza del solo blocco di testo, senza padding/margine — serve al renderer per centrarlo nel box. */
  blockHeight: number;
  balloonWidth: number;
  balloonHeight: number;
}

export interface RenderConfig {
  width: number;
  height: number;
  fontFamily: string;
  lineHeight: number;
  padding: number;
  tailWidthPx: number;
  /** Stile grafico dei balloon (§8.2), dichiarato in `project.balloon_style` — non costanti nel renderer. */
  balloonStyle: BalloonStyle;
  /** Stile del layer bozza (§5.5), dichiarato in `project.draft_style`. */
  draftStyle: DraftStyle;
  /**
   * Corpo base del lettering per questo target: serve al layer bozza per
   * dimensionare badge e annotazioni in unità di pagina (§8.1).
   */
  baseFontSizePx: number;
  /**
   * Target di render corrente: decide quale `panel.render[target]` conta per
   * stabilire se un pannello è ancora da disegnare.
   */
  target: string;
  /**
   * Disegna la specifica nei pannelli senza arte. Default attivo: una pagina
   * non disegnata dev'essere leggibile. Si spegne per l'export finale, dove
   * un pannello vuoto è un pannello vuoto.
   */
  draft?: boolean;
  /**
   * Scala di bordi e tratti dei pannelli, che nel documento sono in pixel della
   * pagina canonica: una tavola a 600 dpi con i bordi a 3 px avrebbe un filo
   * invisibile. Default 1.
   */
  strokeScale?: number;
  /** Fondo del canvas; senza, il fondo è trasparente (e il PNG lo resta). */
  background?: string;
  /** `gray` converte l'intera tavola in scala di grigi, per la stampa manga (§4). */
  color?: "srgb" | "gray" | "cmyk";
  /**
   * Finestra del canvas da emettere, se non è tutto. Serve alla striscia: ogni
   * slice è lo stesso disegno visto da una finestra diversa, così una giunzione
   * non può mai disallinearsi fra due immagini consecutive.
   */
  viewport?: { x: number; y: number; width: number; height: number };
  /**
   * Immagine dell'arte per pannello: id → riferimento già risolto dall'host
   * (blob URL nell'anteprima, data URI nell'export, percorso in Node). Il
   * documento conserva solo il percorso in `art/` (§5.8: niente pixel nel
   * JSON); come arrivarci lo sa chi renderizza, non il Core.
   */
  art?: ReadonlyMap<string, string>;
}
