import { describe, expect, it } from "vitest";
import { computePageFits } from "@comic-builder/lettering";
import { loadSampleFont } from "@comic-builder/lettering/sampleFont";
import { panelNeedsDraft, cameraSpecLine, castSpecLine } from "../src/render/renderDraft.js";
import { renderPageSvg } from "../src/render/renderSvg.js";
import { resolvePageLayout } from "../src/layout/resolveLayout.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { sampleScene } from "../src/fixtures/sample-scene.js";
import { LetteringConfigSchema, BalloonStyleSchema, DraftStyleSchema } from "../src/schema/project.js";
import type { RenderConfig } from "../src/render/types.js";
import type { PageLayout } from "../src/schema/page.js";

const W = 1600;
const H = 2400;
const MARGIN = 56;
const TARGET = "digital-page";

const LETTERING = LetteringConfigSchema.parse({
  font_family: "Comic Neue",
  base_size_px: 26,
  line_height: 1.35,
  padding: 12,
  max_width_ratio: 0.62,
  tail_width: 10,
});
const DRAFT_STYLE = DraftStyleSchema.parse({});

function renderFirstPage(draft: boolean): string {
  const pages = buildPagesFromScene({
    chapterId: "ep001",
    scene: sampleScene,
    firstPageNumber: 1,
    primaryTarget: TARGET,
    gutter: { x: 14, y: 18 },
    readingDirection: "ltr",
  });
  const page = pages[0]!;
  const boxes = resolvePageLayout(
    page.layout as PageLayout,
    page.panels,
    W - MARGIN * 2,
    H - MARGIN * 2,
    MARGIN,
    MARGIN,
  );
  const fits = computePageFits({
    page,
    boxes,
    font: loadSampleFont(),
    lettering: LETTERING,
    draftStyle: DRAFT_STYLE,
    target: TARGET,
    draft,
  });
  const config: RenderConfig = {
    width: W,
    height: H,
    fontFamily: LETTERING.font_family,
    lineHeight: LETTERING.line_height,
    padding: LETTERING.padding,
    tailWidthPx: LETTERING.tail_width,
    balloonStyle: BalloonStyleSchema.parse({}),
    draftStyle: DRAFT_STYLE,
    baseFontSizePx: LETTERING.base_size_px,
    target: TARGET,
    draft,
  };
  return renderPageSvg(page, boxes, fits, config);
}

describe("panelNeedsDraft — la bozza sparisce appena arriva l'arte (§5.5)", () => {
  const basePanel = {
    art: { source: null as string | null, status: "missing" as const },
    render: {} as Record<string, unknown>,
  };

  it("un pannello senza arte né render è da disegnare", () => {
    expect(panelNeedsDraft(basePanel as never, TARGET)).toBe(true);
  });

  it("un pannello con arte sorgente non è più da disegnare", () => {
    const withArt = { ...basePanel, art: { source: "art/p01.psd", status: "inked" as const } };
    expect(panelNeedsDraft(withArt as never, TARGET)).toBe(false);
  });

  it("un pannello con un render per il target corrente non è più da disegnare", () => {
    const withRender = {
      ...basePanel,
      render: { [TARGET]: { spec_hash: "abc", file: "renders/x.png", engine: "m", rendered_at: "now" } },
    };
    expect(panelNeedsDraft(withRender as never, TARGET)).toBe(false);
    // ...ma resta da disegnare per un target che non ha ancora un render.
    expect(panelNeedsDraft(withRender as never, "print-b5")).toBe(true);
  });
});

describe("Specifica di disegno (§6.1, §6.2)", () => {
  it("la riga di inquadratura usa il vocabolario chiuso e tiene fuori mood e axis_side", () => {
    const line = cameraSpecLine({
      shot: "MS",
      angle: "low",
      lens_mm: 24,
      dof: "deep",
      lighting: "backlit",
      mood: "dread",
      motion: "implied",
      subject_placement: "center",
      axis_side: "A-right",
    });
    expect(line).toBe("MS · low · 24mm · backlit · implied");
    expect(line).not.toContain("dread");
    expect(line).not.toContain("A-right");
  });

  it("omette dof e motion quando sono ai valori neutri, per non fare rumore", () => {
    const line = cameraSpecLine({
      shot: "LS",
      angle: "eye",
      lens_mm: 35,
      dof: "deep",
      lighting: "flat",
      mood: "calm",
      motion: "static",
      subject_placement: "center",
      axis_side: "A-left",
    });
    expect(line).toBe("LS · eye · 35mm · flat");
  });

  it("il cast dichiara chi c'è e come va inquadrato, o che non c'è nessuno", () => {
    expect(castSpecLine({ characters: [{ ref: "sara", framing: "head-only" }] } as never)).toBe("sara (head-only)");
    expect(castSpecLine({ characters: [] } as never)).toBe("— nessun personaggio");
  });
});

describe("Layer bozza nel render", () => {
  it("scrive inquadratura, azione e cast nei pannelli non ancora disegnati", () => {
    const svg = renderFirstPage(true);
    expect(svg).toContain("LS · high · 24mm");
    expect(svg).toContain("Il faro sulla scogliera");
    expect(svg).toContain("sara (full-body)");
  });

  it("si spegne quando la bozza non è richiesta: un pannello vuoto resta vuoto", () => {
    const svg = renderFirstPage(false);
    expect(svg).not.toContain("LS · high · 24mm");
    expect(svg).not.toContain("Il faro sulla scogliera");
    // I balloon, che sono contenuto e non annotazione, restano.
    expect(svg).toContain("È spenta da quanto?");
  });

  it("non lascia sbordare il testo dell'azione fuori dal pannello", () => {
    const pages = buildPagesFromScene({
      chapterId: "ep001",
      scene: sampleScene,
      firstPageNumber: 1,
      primaryTarget: TARGET,
      gutter: { x: 14, y: 18 },
      readingDirection: "ltr",
    });
    const page = pages[0]!;
    const boxes = resolvePageLayout(
      page.layout as PageLayout,
      page.panels,
      W - MARGIN * 2,
      H - MARGIN * 2,
      MARGIN,
      MARGIN,
    );
    const fits = computePageFits({
      page,
      boxes,
      font: loadSampleFont(),
      lettering: LETTERING,
      draftStyle: DRAFT_STYLE,
      target: TARGET,
    });

    for (const panel of page.panels) {
      const fit = fits.get(panel.id);
      const box = boxes.get(panel.id)!;
      if (!fit) continue;
      // Il blocco misurato deve stare nella larghezza utile del pannello.
      expect(fit.balloonWidth).toBeLessThanOrEqual(box.width - DRAFT_STYLE.padding * 2 + 1);
    }
  });
});
