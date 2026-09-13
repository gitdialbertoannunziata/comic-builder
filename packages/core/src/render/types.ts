import type { Emphasis } from "../schema/balloon.js";

/**
 * Risultato del fitting testo di un balloon, calcolato a monte (dal pacchetto
 * lettering, che misura i glifi reali via opentype.js). Il renderer del Core
 * consuma solo questa forma di dati — mai il font stesso — per non reintrodurre
 * una dipendenza da opentype.js nel Core (§11.2: unica dipendenza, zod).
 */
export interface LetteringFit {
  lines: Array<Array<{ text: string; em?: Emphasis }>>;
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
}
