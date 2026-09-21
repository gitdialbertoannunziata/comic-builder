import { describe, expect, it } from "vitest";
import { sampleProject, samplePage } from "../src/fixtures/index.js";
import { ProjectSchema, type PageTarget } from "../src/schema/project.js";
import { resolvePageTargetGeometry, trimSizePx, validateTargets } from "../src/targets/geometry.js";
import { pageForTarget, resolvePageBoxesForTarget, scaleStyles } from "../src/targets/pageTarget.js";
import { pageRegions } from "../src/targets/regions.js";
import { LetteringConfigSchema, BalloonStyleSchema, DraftStyleSchema } from "../src/schema/project.js";
import { validateDocument } from "../src/validate/validateDocument.js";

function pageTarget(id: string): PageTarget {
  const t = sampleProject.targets.find((x) => x.id === id);
  if (!t || t.kind !== "page") throw new Error(id);
  return t;
}

describe("Geometria del target (§4)", () => {
  it("la pagina digitale canonica è a scala 1, senza bleed", () => {
    const g = resolvePageTargetGeometry(pageTarget("digital-page"), sampleProject);
    expect([g.width, g.height, g.bleed, g.scale]).toEqual([1600, 2400, 0, 1]);
    expect(g.content).toEqual({ x: 56, y: 56, width: 1488, height: 2288 });
  });

  it("la B5 a 600 dpi si converte da millimetri, con il bleed attorno al taglio", () => {
    const g = resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject);
    expect(trimSizePx(pageTarget("print-b5"))).toEqual([4299, 6071]);
    expect(g.bleed).toBe(71); // 3 mm a 600 dpi
    expect([g.width, g.height]).toEqual([4299 + 142, 6071 + 142]);
    expect(g.trim).toEqual({ x: 71, y: 71, width: 4299, height: 6071 });
    expect(g.scale).toBeCloseTo(4299 / 1600, 6);
  });

  it("i margini scalano in unità di pagina, e l'area sicura fa da minimo", () => {
    const g = resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject);
    // 56 px canonici × 2,687 ≈ 150 px, più dei 118 px dei 5 mm di area sicura.
    expect(g.content.x - g.trim.x).toBeCloseTo(56 * g.scale, 6);

    const tight = ProjectSchema.parse({ ...sampleProject, page: { margin: { top: 0, right: 0, bottom: 0, left: 0 } } });
    const g2 = resolvePageTargetGeometry(pageTarget("print-b5"), tight);
    expect(g2.content.x - g2.trim.x).toBeCloseTo((5 / 25.4) * 600, 6);
  });

  it("la scala di grigi è dichiarata dal target, non dal codice", () => {
    expect(resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject).color).toBe("gray");
  });
});

describe("validateTargets — errori di configurazione prima dell'export", () => {
  it("il progetto d'esempio è coerente", () => {
    expect(validateTargets(sampleProject).filter((i) => i.level === "error")).toEqual([]);
  });

  it("segnala sorgenti mancanti, misure assenti e bleed senza dpi", () => {
    const codes = validateTargets({
      targets: [
        { id: "a", kind: "page", color: "srgb", reading_direction: "ltr", format: "png", quality: 1, lettering_scale: 1, primary: true },
        { id: "b", kind: "page", size_mm: [100, 100], bleed_mm: 3, color: "cmyk", reading_direction: "ltr", format: "png", quality: 1, lettering_scale: 1, primary: false },
        { id: "r", kind: "regions", source: "nessuno", primary: false },
      ],
    }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["target.no-size", "target.bleed-without-dpi", "target.cmyk-unsupported", "target.missing-source"]));
  });
});

describe("Re-layout, non resize (§4.1 regola 3)", () => {
  it("sulla B5 la griglia si risolve di nuovo: i pannelli cambiano forma ma coprono l'area utile", () => {
    const digital = resolvePageTargetGeometry(pageTarget("digital-page"), sampleProject);
    const print = resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject);
    const a = resolvePageBoxesForTarget(samplePage, digital);
    const b = resolvePageBoxesForTarget(samplePage, print);

    const ratio = (box: { width: number; height: number }) => box.width / box.height;
    const first = samplePage.panels[0]!.id;
    // B5 è meno allungata di 2:3, quindi i pannelli diventano più larghi in proporzione.
    expect(ratio(b.get(first)!)).toBeGreaterThan(ratio(a.get(first)!));

    for (const box of b.values()) {
      expect(box.x).toBeGreaterThanOrEqual(print.content.x - 1e-6);
      expect(box.y).toBeGreaterThanOrEqual(print.content.y - 1e-6);
      expect(box.x + box.width).toBeLessThanOrEqual(print.content.x + print.content.width + 1e-6);
      expect(box.y + box.height).toBeLessThanOrEqual(print.content.y + print.content.height + 1e-6);
    }
  });

  it("i gutter scalano con la pagina", () => {
    const print = resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject);
    const boxes = [...resolvePageBoxesForTarget(samplePage, print).values()].sort((p, q) => p.y - q.y || p.x - q.x);
    const layout = samplePage.layout;
    if (layout.mode !== "page") throw new Error();
    const top = boxes[0]!;
    const next = boxes.find((b) => b.y > top.y + 1)!;
    expect(next.y - (top.y + top.height)).toBeCloseTo(layout.gutter.y * print.scale, 3);
  });

  it("gli stili in pixel scalano, i rapporti no", () => {
    const styles = {
      lettering: LetteringConfigSchema.parse(sampleProject.lettering),
      balloonStyle: BalloonStyleSchema.parse({}),
      draftStyle: DraftStyleSchema.parse({}),
    };
    const scaled = scaleStyles(styles, 2);
    expect(scaled.lettering.base_size_px).toBe(52);
    expect(scaled.lettering.line_height).toBe(styles.lettering.line_height);
    expect(scaled.balloonStyle.base.stroke_width).toBe(4);
    expect(scaled.balloonStyle.by_type.shout?.stroke_width).toBe(8);
    expect(scaled.balloonStyle.by_type.whisper?.dash).toBe("6 4");
  });
});

describe("Override di posizionamento per target (§4.1 regola 3)", () => {
  const talking = samplePage.panels.findIndex((p) => p.balloons.length > 0);
  const withOverride = {
    ...samplePage,
    panels: samplePage.panels.map((panel, i) =>
      i !== talking
        ? panel
        : {
            ...panel,
            balloons: panel.balloons.map((b, j) =>
              j === 0 ? { ...b, per_target: { "print-b5": { anchor: { x: 0.5, y: 0.6 }, font_scale: 0.9 } } } : b,
            ),
          },
    ),
  };

  it("sostituisce ancora e corpo solo per il target indicato", () => {
    expect(talking).toBeGreaterThanOrEqual(0);
    const original = withOverride.panels[talking]!.balloons[0]!;
    const print = pageForTarget(withOverride, "print-b5").panels[talking]!.balloons[0]!;
    expect(print.anchor).toEqual({ x: 0.5, y: 0.6 });
    expect(print.font_scale).toBe(0.9);
    expect(print.text).toEqual(original.text);
    expect(pageForTarget(withOverride, "digital-page").panels[talking]!.balloons[0]!.anchor).toEqual(original.anchor);
  });

  it("senza override restituisce la stessa pagina", () => {
    expect(pageForTarget(samplePage, "print-b5")).toBe(samplePage);
    expect(validateDocument(pageForTarget(withOverride, "print-b5")).filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("Guided view (§4.2)", () => {
  it("un rettangolo normalizzato al taglio per pannello, in ordine di lettura", () => {
    const g = resolvePageTargetGeometry(pageTarget("print-b5"), sampleProject);
    const boxes = resolvePageBoxesForTarget(samplePage, g);
    const result = pageRegions(samplePage, boxes, g, "p.png", "ltr");
    const layout = samplePage.layout;
    if (layout.mode !== "page") throw new Error();

    expect(result.regions.map((r) => r.panel)).toEqual(layout.reading_order);
    expect(result.regions.map((r) => r.order)).toEqual(layout.reading_order.map((_, i) => i + 1));
    for (const r of result.regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1);
      expect(r.y + r.height).toBeLessThanOrEqual(1);
    }
  });
});
