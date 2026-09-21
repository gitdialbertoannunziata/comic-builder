import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { prepareStrip, renderStripWindow, type Command, type ExportContext, type SliceCut } from "@comic-builder/core";

interface Props {
  context: ExportContext;
  targetId: string;
  selectedPanelId: string;
  onSelect: (pageId: string, panelId: string) => void;
  run: (command: Command) => boolean;
}

/** Larghezza a cui si mostra la striscia: quella di un telefono, dove verrà letta. */
const DISPLAY_WIDTH = 420;
const GATE_RATIO = 0.2;

const CUT_LABEL: Record<SliceCut["kind"], string> = {
  gutter: "nel gutter",
  panel: "dentro un pannello: controlla",
  obstacle: "attraverso un balloon o una zona protetta",
};

/**
 * La striscia dell'episodio come la vedrà il lettore, con sopra i tagli
 * dello slicing (§7.2). È anche il posto dove si segnano le zone da non
 * tagliare — i volti, che la geometria non conosce: in v1 li indica
 * l'autore (§7.2), e il taglio le evita come fa con i balloon.
 *
 * Virtualizzata: ogni slice è un SVG autonomo (`renderStripWindow`) montato
 * solo quando arriva vicino allo schermo. Un episodio di sessanta pagine
 * resta scorrevole perché nel DOM ce ne sono poche alla volta.
 */
export function StripView({ context, targetId, selectedPanelId, onSelect, run }: Props) {
  const prepared = useMemo(() => prepareStrip(context, targetId), [context, targetId]);
  const scale = DISPLAY_WIDTH / prepared.strip.width;
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([0, 1]));
  const [bandMode, setBandMode] = useState(false);
  const [drawing, setDrawing] = useState<{ index: number; pageId: string; panelId: string; y0: number; y1: number } | null>(null);
  const chunks = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((previous) => {
          const next = new Set(previous);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.slice);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      { rootMargin: "100% 0px" },
    );
    for (const el of chunks.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [prepared]);

  const svgCache = useRef(new Map<number, string>());
  useEffect(() => svgCache.current.clear(), [prepared]);
  function svgFor(index: number): string {
    let svg = svgCache.current.get(index);
    if (!svg) {
      const slice = prepared.plan.slices[index]!;
      svg = renderStripWindow(prepared, slice.y, slice.height);
      svgCache.current.set(index, svg);
    }
    return svg;
  }

  const { plan, strip } = prepared;
  const report = plan.report;
  const gutterCuts = plan.cuts.filter((c) => c.kind === "gutter").length;

  function stripY(event: ReactPointerEvent, sliceY: number): number {
    const rect = (event.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return sliceY + (event.clientY - rect.top) / scale;
  }

  return (
    <div className="strip-view">
      <div className="strip-view__head">
        <span>
          {plan.slices.length} slice{report.shortSlices > 0 ? ` (${report.shortSlices} corte, per non tagliare l'arte)` : ""} · {gutterCuts}/{plan.cuts.length} tagli nei gutter · pagine da
          controllare {report.pagesToCheck.length}/{report.pages}{" "}
          <strong className={report.checkRatio < GATE_RATIO ? "gate gate--ok" : "gate gate--ko"}>
            ({Math.round(report.checkRatio * 100)}%{report.checkRatio < GATE_RATIO ? ", gate superato" : ", sopra il 20%"})
          </strong>
        </span>
        <label className="field field--row">
          <input type="checkbox" checked={bandMode} onChange={(e) => setBandMode(e.target.checked)} />
          <span>segna zone da non tagliare</span>
        </label>
      </div>
      {bandMode && (
        <p className="field__hint">Trascina in verticale su un pannello per proteggere una fascia (un volto, un dettaglio). Clic su una zona per toglierla.</p>
      )}

      <div className="strip-view__strip" style={{ width: DISPLAY_WIDTH }}>
        {plan.slices.map((slice, index) => {
          const cut = plan.cuts[index];
          const placements = strip.placements.filter((p) => p.box.y < slice.y + slice.height && p.box.y + p.box.height > slice.y);
          return (
            <div
              key={index}
              ref={(el) => {
                chunks.current[index] = el;
              }}
              data-slice={index}
              className="strip-chunk"
              style={{ height: slice.height * scale }}
            >
              {visible.has(index) && <div className="strip-chunk__art" dangerouslySetInnerHTML={{ __html: svgFor(index) }} />}
              <svg className="strip-chunk__overlay" viewBox={`0 ${slice.y} ${strip.width} ${slice.height}`} preserveAspectRatio="none">
                {placements.map(({ pageId, panel, box }) => (
                  <g key={panel.id}>
                    <rect
                      className={`strip-hit${panel.id === selectedPanelId ? " strip-hit--selected" : ""}${bandMode ? " strip-hit--band" : ""}`}
                      x={box.x}
                      y={box.y}
                      width={box.width}
                      height={box.height}
                      onClick={() => !bandMode && onSelect(pageId, panel.id)}
                      onPointerDown={(e) => {
                        if (!bandMode) return;
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        const y = stripY(e, slice.y);
                        setDrawing({ index, pageId, panelId: panel.id, y0: y, y1: y });
                      }}
                      onPointerMove={(e) => drawing && drawing.panelId === panel.id && setDrawing({ ...drawing, y1: stripY(e, slice.y) })}
                      onPointerUp={() => {
                        if (!drawing || drawing.panelId !== panel.id) return;
                        const from = Math.max(0, (Math.min(drawing.y0, drawing.y1) - box.y) / box.height);
                        const to = Math.min(1, (Math.max(drawing.y0, drawing.y1) - box.y) / box.height);
                        setDrawing(null);
                        // Una fascia di pochi pixel è quasi sempre un clic mancato, non un volto.
                        if ((to - from) * box.height < 24) return;
                        run({ type: "panel.update", pageId, panelId: panel.id, patch: { slice_avoid: [...panel.slice_avoid, { from, to }] } });
                      }}
                    >
                      <title>{panel.id}</title>
                    </rect>
                    {panel.slice_avoid.map((band, b) => (
                      <rect
                        key={b}
                        className="strip-band"
                        x={box.x}
                        y={box.y + band.from * box.height}
                        width={box.width}
                        height={(band.to - band.from) * box.height}
                        onClick={() =>
                          bandMode && run({ type: "panel.update", pageId, panelId: panel.id, patch: { slice_avoid: panel.slice_avoid.filter((_, i) => i !== b) } })
                        }
                      >
                        <title>Zona da non tagliare{bandMode ? ": clic per toglierla" : ""}</title>
                      </rect>
                    ))}
                  </g>
                ))}
                {drawing?.index === index && (
                  <rect className="strip-band strip-band--drawing" x={0} y={Math.min(drawing.y0, drawing.y1)} width={strip.width} height={Math.abs(drawing.y1 - drawing.y0)} />
                )}
              </svg>
              {cut && (
                <div className={`strip-cut strip-cut--${cut.kind}`} title={CUT_LABEL[cut.kind]}>
                  <span>
                    taglio {index + 1} · {CUT_LABEL[cut.kind]}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
