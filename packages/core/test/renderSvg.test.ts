import { describe, expect, it } from "vitest";
import { loadSampleFont, fitBalloonText, type LoadedFont } from "@comic-builder/lettering";
import { samplePage } from "../src/fixtures/sample-page.js";
import { resolvePageLayout, resolveStripFromPage } from "../src/layout/resolveLayout.js";
import { renderPageSvg, renderStripSvg } from "../src/render/renderSvg.js";
import { LetteringConfigSchema, BalloonStyleSchema } from "../src/schema/project.js";
import type { Box } from "../src/layout/resolveLayout.js";
import type { LetteringFit, RenderConfig } from "../src/render/types.js";
import type { StripLayout } from "../src/schema/page.js";

const PAGE_W = 1600;
const PAGE_H = 2400;
const MARGIN = 56;

// safety_margin_ratio non specificato: prende il default dichiarato nello
// schema (§5.2), non un numero nascosto nel renderer o nel pacchetto lettering.
const LETTERING = LetteringConfigSchema.parse({
  font_family: "ComicNeue",
  base_size_px: 26,
  line_height: 1.35,
  padding: 12,
  max_width_ratio: 0.62,
  tail_width: 10,
});

// Anche qui: nessun override, solo i default dichiarati (whisper tratteggiato,
// thought punteggiato, shout più spesso, caption con raggio piccolo — §8.2).
const BALLOON_STYLE = BalloonStyleSchema.parse({});

function computeFits(font: LoadedFont, boxes: Map<string, Box>): Map<string, LetteringFit> {
  const fits = new Map<string, LetteringFit>();
  for (const panel of samplePage.panels) {
    const box = boxes.get(panel.id);
    if (!box) continue;
    for (const balloon of panel.balloons) {
      const result = fitBalloonText({
        runs: balloon.text,
        font,
        baseFontSizePx: LETTERING.base_size_px,
        fontScale: balloon.font_scale,
        lineHeight: LETTERING.line_height,
        padding: LETTERING.padding,
        safetyMarginRatio: LETTERING.safety_margin_ratio,
        maxWidthPx: box.width * LETTERING.max_width_ratio,
        maxHeightPx: box.height * 0.9,
      });
      fits.set(balloon.id, {
        lines: result.lines,
        fontSizePx: result.fontSizePx,
        blockHeight: result.blockHeight,
        balloonWidth: result.balloonWidth,
        balloonHeight: result.balloonHeight,
      });
    }
  }
  return fits;
}

function renderConfig(width: number, height: number): RenderConfig {
  return {
    width,
    height,
    fontFamily: LETTERING.font_family,
    lineHeight: LETTERING.line_height,
    padding: LETTERING.padding,
    tailWidthPx: LETTERING.tail_width,
    balloonStyle: BALLOON_STYLE,
  };
}

describe("renderPageSvg / renderStripSvg — golden (§11.4, criterio d'uscita F0)", () => {
  const font = loadSampleFont();

  it("la pagina a 6 pannelli produce un SVG valido e stabile", () => {
    const boxes = resolvePageLayout(
      samplePage.layout.mode === "page"
        ? samplePage.layout
        : (() => {
            throw new Error("fixture non in modalità page");
          })(),
      samplePage.panels,
      PAGE_W - MARGIN * 2,
      PAGE_H - MARGIN * 2,
      MARGIN,
      MARGIN,
    );
    const fits = computeFits(font, boxes);

    const svg = renderPageSvg(samplePage, boxes, fits, renderConfig(PAGE_W, PAGE_H));

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 1600 2400"');
    // 6 rect di bordo pannello + 1 rect arrotondato per l'unico balloon.
    expect(svg.match(/<rect /g)).toHaveLength(7);
    // La coda del balloon.
    expect(svg.match(/<polygon/g)).toHaveLength(1);
    expect(svg).toContain("niente");
    expect(svg).toMatchSnapshot();
  });

  it("la striscia derivata dalla stessa pagina produce un SVG valido e stabile", () => {
    const pageBoxes = resolvePageLayout(
      samplePage.layout.mode === "page"
        ? samplePage.layout
        : (() => {
            throw new Error("fixture non in modalità page");
          })(),
      samplePage.panels,
      PAGE_W - MARGIN * 2,
      PAGE_H - MARGIN * 2,
      MARGIN,
      MARGIN,
    );

    const stripLayout: StripLayout = {
      mode: "strip",
      width_ratio: 1,
      panel_gap: 0,
      sequence: samplePage.panels.map((p) => p.id),
    };
    const stripWidth = 1080;
    const stripBoxes = resolveStripFromPage(stripLayout, pageBoxes, stripWidth);
    const stripHeight = [...stripBoxes.values()].reduce((max, b) => Math.max(max, b.y + b.height), 0);
    const stripFits = computeFits(font, stripBoxes);

    const svg = renderStripSvg(
      samplePage,
      stripLayout,
      stripBoxes,
      stripFits,
      renderConfig(stripWidth, stripHeight),
    );

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 1080 ${stripHeight}"`);
    expect(svg.match(/<rect /g)).toHaveLength(7);
    expect(svg.match(/<polygon/g)).toHaveLength(1);
    expect(svg).toMatchSnapshot();
  });
});

describe("renderPageSvg — stile grafico dei balloon (§8.2, project.balloon_style)", () => {
  it("uno stile di base personalizzato arriva fino all'SVG renderizzato", () => {
    const font = loadSampleFont();
    const boxes = resolvePageLayout(
      samplePage.layout.mode === "page"
        ? samplePage.layout
        : (() => {
            throw new Error("fixture non in modalità page");
          })(),
      samplePage.panels,
      PAGE_W - MARGIN * 2,
      PAGE_H - MARGIN * 2,
      MARGIN,
      MARGIN,
    );
    const fits = computeFits(font, boxes);

    const customConfig: RenderConfig = {
      ...renderConfig(PAGE_W, PAGE_H),
      balloonStyle: BalloonStyleSchema.parse({
        base: { stroke: "#2a2a2a", stroke_width: 3, fill: "#fffaf0", corner_radius_px: 6 },
      }),
    };

    const svg = renderPageSvg(samplePage, boxes, fits, customConfig);

    expect(svg).toContain('fill="#fffaf0"');
    expect(svg).toContain('stroke="#2a2a2a"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('rx="6"');
    // Non tocca il bordo dei pannelli, che resta nero fisso (non fa parte di balloon_style).
    expect(svg).toContain('stroke="black" stroke-width="3"');
  });

  it("un override per tipo cambia solo quel tipo, gli altri restano sulla base", () => {
    const font = loadSampleFont();
    const boxes = resolvePageLayout(
      samplePage.layout.mode === "page"
        ? samplePage.layout
        : (() => {
            throw new Error("fixture non in modalità page");
          })(),
      samplePage.panels,
      PAGE_W - MARGIN * 2,
      PAGE_H - MARGIN * 2,
      MARGIN,
      MARGIN,
    );
    const fits = computeFits(font, boxes);

    // L'unico balloon della fixture è "speech": un override su "thought" non deve avere effetto.
    const customConfig: RenderConfig = {
      ...renderConfig(PAGE_W, PAGE_H),
      balloonStyle: BalloonStyleSchema.parse({
        by_type: { thought: { fill: "#e0e0ff" } },
      }),
    };

    const svg = renderPageSvg(samplePage, boxes, fits, customConfig);
    expect(svg).not.toContain("#e0e0ff");
    expect(svg).toContain('fill="white"');
  });
});
