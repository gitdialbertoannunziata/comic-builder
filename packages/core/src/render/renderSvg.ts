import type { Page } from "../schema/page.js";
import type { StripLayout } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Balloon, BalloonType } from "../schema/balloon.js";
import type { BalloonStyle, BalloonVisualStyle } from "../schema/project.js";
import type { Box } from "../layout/resolveLayout.js";
import type { LetteringFit, RenderConfig } from "./types.js";
import { panelNeedsDraft, renderPanelDraft } from "./renderDraft.js";
import { artPlacement, balloonBox, tailPoint } from "./geometry.js";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPanelBorder(panel: Panel, box: Box, scale: number): string {
  if (panel.border.style === "none") return "";
  const dash = panel.border.style === "dashed" ? ` stroke-dasharray="${8 * scale} ${6 * scale}"` : "";
  const radius = panel.border.radius * scale;
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" ry="${radius}" fill="none" stroke="black" stroke-width="${panel.border.width * scale}"${dash}/>`;
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
  const { x, y, width: w, height: h } = balloonBox(balloon, containerBox, fit);
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
    const target = tailPoint(balloon, containerBox, { x, y, width: w, height: h });
    tail = renderTail({ x: centerX, y: centerY }, w / 2, h / 2, target, config.tailWidthPx, visual);
  }

  // Centrato nell'altezza del box, non `y + padding`: il box può includere un
  // margine di sicurezza oltre al padding dichiarato (§8.1, pacchetto lettering),
  // e centrare sulla differenza reale lo distribuisce simmetricamente in ogni caso.
  const textTopY = y + (h - fit.blockHeight) / 2;
  const text = `<text x="${centerX}" y="${textTopY}" font-family="${escapeXml(config.fontFamily)}" font-size="${fit.fontSizePx}" text-anchor="middle">${renderTextLines(fit, centerX, textTopY, config.lineHeight)}</text>`;

  return `${tail}${shape}${text}`;
}

/**
 * L'arte riempie il pannello e si ritaglia sul suo bordo ("cover"): il
 * pannello è la finestra, e un disegno fatto al rapporto giusto (§7.4, ramo
 * manuale) ci entra esatto. Se il documento dichiara un'arte che l'host non
 * ha trovato, in bozza lo si dice sul pannello invece di lasciarlo vuoto in
 * silenzio; nell'export finale resta vuoto, e lo segnala il piano d'export.
 */
function renderPanelArt(panel: Panel, box: Box, config: RenderConfig): string {
  if (!panel.art.source) return "";
  const href = config.art?.get(panel.id);
  const clipId = `cb-clip-${panel.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const radius = panel.border.radius * (config.strokeScale ?? 1);
  if (href) {
    const clip = `<clipPath id="${clipId}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${radius}" ry="${radius}"/></clipPath>`;
    // Con le dimensioni dell'immagine si applica l'inquadratura dell'autore;
    // senza, il ripiego è il riempimento centrato di sempre.
    if (panel.art.size) {
      const at = artPlacement(box, panel.art.size, panel.art.frame);
      return (
        clip +
        `<image href="${escapeXml(href)}" x="${at.x}" y="${at.y}" width="${at.width}" height="${at.height}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>`
      );
    }
    return (
      clip +
      `<image href="${escapeXml(href)}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
    );
  }
  if (!(config.draft ?? true)) return "";
  const size = config.baseFontSizePx * 0.6;
  return (
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#fdf3e0"/>` +
    `<text x="${box.x + box.width / 2}" y="${box.y + box.height / 2}" font-family="${escapeXml(config.fontFamily)}" font-size="${size}" text-anchor="middle" fill="#8a5a00">arte non trovata: ${escapeXml(panel.art.source)}</text>`
  );
}

function renderPanel(panel: Panel, box: Box, fits: Map<string, LetteringFit>, config: RenderConfig): string {
  let out = renderPanelArt(panel, box, config);

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

  out += renderPanelBorder(panel, box, config.strokeScale ?? 1);
  for (const balloon of panel.balloons) {
    const fit = fits.get(balloon.id);
    if (!fit) continue;
    out += renderBalloon(balloon, box, fit, config);
  }
  return out;
}

function svgRoot(config: RenderConfig, body: string): string {
  const view = config.viewport ?? { x: 0, y: 0, width: config.width, height: config.height };
  const background = config.background
    ? `<rect x="0" y="0" width="${config.width}" height="${config.height}" fill="${escapeXml(config.background)}"/>`
    : "";
  let content = background + body;
  if (config.color === "gray") {
    // Una matrice di saturazione a zero, non un'altra tavolozza: il disegno
    // resta quello, cambia solo come esce. Luminanza secondo il filtro SVG.
    content =
      `<defs><filter id="cb-gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>` +
      `<g filter="url(#cb-gray)">${content}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" width="${view.width}" height="${view.height}">${content}</svg>`;
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

/**
 * Renderizza un'intera striscia d'episodio: pannelli di più pagine già
 * collocati (vedi `resolveEpisodeStrip`). Con `config.viewport` emette solo
 * una slice — lo stesso disegno visto da una finestra diversa.
 */
export function renderEpisodeStripSvg(
  placements: ReadonlyArray<{ panel: Panel; box: Box }>,
  fits: Map<string, LetteringFit>,
  config: RenderConfig,
): string {
  let body = "";
  for (const { panel, box } of placements) body += renderPanel(panel, box, fits, config);
  return svgRoot(config, body);
}
