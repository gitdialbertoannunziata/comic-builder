import type { Page } from "../schema/page.js";
import type { StripLayout } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Balloon, BalloonType } from "../schema/balloon.js";
import type { BalloonStyle, BalloonVisualStyle } from "../schema/project.js";
import type { Box } from "../layout/resolveLayout.js";
import type { LetteringFit, RenderConfig } from "./types.js";
import { panelNeedsDraft, renderPanelDraft } from "./renderDraft.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPanelBorder(panel: Panel, box: Box): string {
  if (panel.border.style === "none") return "";
  const dash = panel.border.style === "dashed" ? ' stroke-dasharray="8 6"' : "";
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${panel.border.radius}" ry="${panel.border.radius}" fill="none" stroke="black" stroke-width="${panel.border.width}"${dash}/>`;
}

/**
 * Stile effettivo di un tipo di balloon: base + override dichiarati in
 * `project.balloon_style.by_type` (§8.2) — non più costanti nel renderer.
 * Approssimazione volutamente semplice per F0: whisper/thought si distinguono
 * col tratteggio, shout con uno stroke più spesso. Forme a nuvoletta/stella
 * complete restano un affinamento successivo, non un presupposto di questa fase.
 */
function resolveBalloonVisual(style: BalloonStyle, type: BalloonType): BalloonVisualStyle {
  const override = style.by_type[type];
  return {
    stroke: override?.stroke ?? style.base.stroke,
    stroke_width: override?.stroke_width ?? style.base.stroke_width,
    fill: override?.fill ?? style.base.fill,
    corner_radius_px: override?.corner_radius_px ?? style.base.corner_radius_px,
    dash: override?.dash ?? style.base.dash,
  };
}

function hasTail(type: BalloonType): boolean {
  return type !== "caption" && type !== "sfx";
}

function hasContainer(type: BalloonType): boolean {
  return type !== "sfx";
}

interface Point {
  x: number;
  y: number;
}

/** Punto sul bordo dell'ellisse che approssima il balloon, in direzione di `target` (per la coda). */
function ellipseBoundaryPoint(center: Point, rx: number, ry: number, target: Point): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x, y: center.y + ry };
  const angle = Math.atan2(dy / ry, dx / rx);
  return { x: center.x + rx * Math.cos(angle), y: center.y + ry * Math.sin(angle) };
}

function renderTail(
  center: Point,
  rx: number,
  ry: number,
  target: Point,
  tailWidthPx: number,
  visual: BalloonVisualStyle,
): string {
  const edge = ellipseBoundaryPoint(center, rx, ry, target);
  const dx = target.x - edge.x;
  const dy = target.y - edge.y;
  const len = Math.hypot(dx, dy) || 1;
  const perpX = (-dy / len) * (tailWidthPx / 2);
  const perpY = (dx / len) * (tailWidthPx / 2);
  const base1 = { x: edge.x + perpX, y: edge.y + perpY };
  const base2 = { x: edge.x - perpX, y: edge.y - perpY };
  return `<polygon points="${base1.x},${base1.y} ${base2.x},${base2.y} ${target.x},${target.y}" fill="${escapeXml(visual.fill)}" stroke="${escapeXml(visual.stroke)}" stroke-width="${visual.stroke_width}"/>`;
}

function renderTextLines(fit: LetteringFit, centerX: number, topY: number, lineHeight: number): string {
  let out = "";
  for (let i = 0; i < fit.lines.length; i++) {
    const line = fit.lines[i]!;
    const y = topY + fit.fontSizePx * (i + 1) * lineHeight - fit.fontSizePx * (lineHeight - 1);
    out += `<tspan x="${centerX}" y="${y}">`;
    for (const token of line) {
      const escaped = escapeXml(token.text);
      if (token.em === "bold") out += `<tspan font-weight="bold">${escaped}</tspan>`;
      else if (token.em === "italic") out += `<tspan font-style="italic">${escaped}</tspan>`;
      else if (token.em === "small") out += `<tspan font-size="0.8em">${escaped}</tspan>`;
      else out += escaped;
    }
    out += `</tspan>`;
  }
  return out;
}

/**
 * Il `anchor` del balloon (§5.6) è l'angolo superiore sinistro della sua
 * bounding box, normalizzato al pannello che lo contiene; `tail.target` usa
 * la stessa convenzione. È un'assunzione di questo renderer (il piano non la
 * fissa esplicitamente) — coerente con l'esempio di §5.6.
 */
function renderBalloon(balloon: Balloon, containerBox: Box, fit: LetteringFit, config: RenderConfig): string {
  const x = containerBox.x + balloon.anchor.x * containerBox.width;
  const y = containerBox.y + balloon.anchor.y * containerBox.height;
  const w = fit.balloonWidth;
  const h = fit.balloonHeight;
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  const visual = resolveBalloonVisual(config.balloonStyle, balloon.type);

  // Rettangolo arrotondato invece di un'ellisse: un'ellisse inscritta nel
  // rettangolo testo+padding è più stretta del rettangolo ai bordi e taglia
  // il testo su una riga larga (verificato visivamente con resvg). Il
  // rettangolo arrotondato garantisce invece di contenere sempre il blocco.
  let shape = "";
  if (hasContainer(balloon.type)) {
    const radius = Math.min(h / 2, visual.corner_radius_px);
    const dashAttr = visual.dash ? ` stroke-dasharray="${escapeXml(visual.dash)}"` : "";
    shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${escapeXml(visual.fill)}" stroke="${escapeXml(visual.stroke)}" stroke-width="${visual.stroke_width}"${dashAttr}/>`;
  }

  let tail = "";
  if (hasContainer(balloon.type) && hasTail(balloon.type) && balloon.tail.mode !== "none") {
    // Senza un target esplicito la bocca dello speaker non è nota. Il default
    // è una coda *corta* appena sotto il balloon, non una che scende fino al
    // fondo del pannello: in un pannello alto quest'ultima attraversa mezza
    // vignetta e incrocia le code degli altri balloon (§8.2 vuole che la coda
    // non attraversi il testo). Resta comunque un ripiego: `tail.target`
    // esplicito è ciò che risolve davvero l'ambiguità.
    const target = balloon.tail.target
      ? {
          x: containerBox.x + balloon.tail.target.x * containerBox.width,
          y: containerBox.y + balloon.tail.target.y * containerBox.height,
        }
      : { x: centerX, y: y + h + containerBox.height * 0.1 };
    tail = renderTail({ x: centerX, y: centerY }, w / 2, h / 2, target, config.tailWidthPx, visual);
  }

  // Centrato nell'altezza del box, non `y + padding`: il box può includere un
  // margine di sicurezza oltre al padding dichiarato (§8.1, pacchetto lettering),
  // e centrare sulla differenza reale lo distribuisce simmetricamente in ogni caso.
  const textTopY = y + (h - fit.blockHeight) / 2;
  const text = `<text x="${centerX}" y="${textTopY}" font-family="${escapeXml(config.fontFamily)}" font-size="${fit.fontSizePx}" text-anchor="middle">${renderTextLines(fit, centerX, textTopY, config.lineHeight)}</text>`;

  return `${tail}${shape}${text}`;
}

function renderPanel(panel: Panel, box: Box, fits: Map<string, LetteringFit>, config: RenderConfig): string {
  let out = "";

  // Layer bozza sotto tutto il resto: è il fondo del pannello finché l'arte
  // non arriva, quindi bordo e balloon gli vanno sopra.
  if ((config.draft ?? true) && panelNeedsDraft(panel, config.target)) {
    out += renderPanelDraft({
      panel,
      box,
      style: config.draftStyle,
      fontFamily: config.fontFamily,
      baseFontSizePx: config.baseFontSizePx,
      lineHeight: config.lineHeight,
      actionFit: fits.get(panel.id),
    });
  }

  out += renderPanelBorder(panel, box);
  for (const balloon of panel.balloons) {
    const fit = fits.get(balloon.id);
    if (!fit) continue;
    out += renderBalloon(balloon, box, fit, config);
  }
  return out;
}

function svgRoot(config: RenderConfig, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${config.width} ${config.height}" width="${config.width}" height="${config.height}">${body}</svg>`;
}

/** Renderizza una pagina in modalità `page` (§7.1) in SVG, layer bordo+balloon+testo. */
export function renderPageSvg(
  page: Page,
  boxes: Map<string, Box>,
  fits: Map<string, LetteringFit>,
  config: RenderConfig,
): string {
  let body = "";
  for (const panel of page.panels) {
    const box = boxes.get(panel.id);
    if (!box) continue;
    body += renderPanel(panel, box, fits, config);
  }
  const pageBox: Box = { x: 0, y: 0, width: config.width, height: config.height };
  for (const overlay of page.overlays) {
    const fit = fits.get(overlay.id);
    if (!fit) continue;
    body += renderBalloon(overlay, pageBox, fit, config);
  }
  return svgRoot(config, body);
}

/** Renderizza la striscia verticale derivata (§7.2), stessa logica di layer applicata ai box impilati. */
export function renderStripSvg(
  page: Page,
  layout: StripLayout,
  boxes: Map<string, Box>,
  fits: Map<string, LetteringFit>,
  config: RenderConfig,
): string {
  const panelsById = new Map(page.panels.map((p) => [p.id, p]));
  let body = "";
  for (const panelId of layout.sequence) {
    const panel = panelsById.get(panelId);
    const box = boxes.get(panelId);
    if (!panel || !box) continue;
    body += renderPanel(panel, box, fits, config);
  }
  return svgRoot(config, body);
}
