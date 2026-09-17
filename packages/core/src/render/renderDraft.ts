import type { Panel } from "../schema/panel.js";
import type { Camera } from "../schema/camera.js";
import type { DraftStyle } from "../schema/project.js";
import type { Box } from "../layout/resolveLayout.js";
import type { LetteringFit } from "./types.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Un pannello è "da disegnare" finché non ha né arte sorgente né un render:
 * è la condizione in cui il layer bozza ha senso, e sparisce da sola appena
 * l'autore importa il disegno (§5.5: `art` è la fonte di verità).
 */
export function panelNeedsDraft(panel: Panel, target: string): boolean {
  if (panel.art.source !== null) return false;
  return !panel.render[target];
}

/**
 * Riga di specifica dell'inquadratura, nel vocabolario chiuso di §6.1.
 * `mood` e `axis_side` restano fuori: il primo governa palette e composizione,
 * il secondo serve al lint di continuità — nessuno dei due è un'istruzione di
 * disegno diretta, e metterli qui aggiungerebbe rumore al foglio.
 */
export function cameraSpecLine(camera: Camera): string {
  const parts = [camera.shot, camera.angle, `${camera.lens_mm}mm`, camera.lighting];
  if (camera.dof !== "deep") parts.push(camera.dof);
  if (camera.motion !== "static") parts.push(camera.motion);
  return parts.join(" · ");
}

/** Chi compare nel pannello e come va inquadrato — l'altra metà della specifica. */
export function castSpecLine(panel: Panel): string {
  if (panel.characters.length === 0) return "— nessun personaggio";
  return panel.characters.map((c) => `${c.ref} (${c.framing})`).join(" · ");
}

function textElement(
  content: string,
  x: number,
  y: number,
  sizePx: number,
  fill: string,
  fontFamily: string,
): string {
  return `<text x="${x}" y="${y}" font-family="${escapeXml(fontFamily)}" font-size="${sizePx}" fill="${fill}">${escapeXml(content)}</text>`;
}

export interface DraftRenderInput {
  panel: Panel;
  box: Box;
  style: DraftStyle;
  fontFamily: string;
  baseFontSizePx: number;
  lineHeight: number;
  /**
   * Testo dell'azione già misurato e mandato a capo a monte, come per i
   * balloon: il Core non misura glifi (§11.2). Se manca, l'azione non viene
   * scritta — meglio un foglio senza una riga che una riga che sborda.
   */
  actionFit?: LetteringFit | undefined;
}

/**
 * Disegna la specifica del pannello: fondo, inquadratura, azione, cast.
 * È il "foglio di spoglio" che rende leggibile una pagina non ancora
 * disegnata — e il motivo per cui un documento strutturato serve a chi
 * disegna a mano quanto a chi genera (§5.5, §6.2).
 */
export function renderPanelDraft(input: DraftRenderInput): string {
  const { panel, box, style, fontFamily } = input;
  const pad = style.padding;
  const annotationSize = input.baseFontSizePx * style.annotation_size_ratio;

  let out = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${style.background}"/>`;

  // Inquadratura, in alto a sinistra.
  out += textElement(
    cameraSpecLine(panel.camera),
    box.x + pad,
    box.y + pad + annotationSize,
    annotationSize,
    style.muted,
    fontFamily,
  );

  // Azione, al centro del pannello: è il contenuto, non un'annotazione.
  if (input.actionFit && input.actionFit.lines.length > 0) {
    const fit = input.actionFit;
    const blockHeight = fit.lines.length * fit.fontSizePx * input.lineHeight;
    const centerX = box.x + box.width / 2;
    const top = box.y + (box.height - blockHeight) / 2;

    let tspans = "";
    for (let i = 0; i < fit.lines.length; i++) {
      const y = top + fit.fontSizePx * (i + 1) * input.lineHeight - fit.fontSizePx * (input.lineHeight - 1);
      const line = fit.lines[i]!.map((token) => escapeXml(token.text)).join("");
      tspans += `<tspan x="${centerX}" y="${y}">${line}</tspan>`;
    }
    out += `<text font-family="${escapeXml(fontFamily)}" font-size="${fit.fontSizePx}" fill="${style.ink}" text-anchor="middle">${tspans}</text>`;
  }

  // Cast, in basso a sinistra.
  out += textElement(
    castSpecLine(panel),
    box.x + pad,
    box.y + box.height - pad,
    annotationSize,
    style.muted,
    fontFamily,
  );

  return out;
}

/**
 * Corpo a cui il chiamante deve misurare il testo dell'azione prima di passare
 * `actionFit`: chi misura sta fuori dal Core, ma la dimensione la decide lo
 * stile della bozza, non chi misura.
 */
export function draftActionFontSizePx(style: DraftStyle, baseFontSizePx: number): number {
  return baseFontSizePx * style.action_size_ratio;
}
