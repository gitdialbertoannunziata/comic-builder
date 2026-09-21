import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  anchorFor,
  balloonBox,
  dragTrackBoundary,
  gutterHandles,
  tailPoint,
  type Box,
  type Command,
  type GutterHandle,
  type LetteringFit,
  type Page,
} from "@comic-builder/core";
import { primaryGeometry } from "../project.js";

interface Props {
  page: Page;
  svg: string | null;
  boxes: Map<string, Box>;
  fits: Map<string, LetteringFit>;
  width: number;
  height: number;
  selectedPanelId: string;
  selectedBalloonId: string | null;
  onSelectPanel: (panelId: string) => void;
  onSelectBalloon: (balloonId: string | null, panelId: string) => void;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  staleNote?: boolean;
}

type Drag =
  | { kind: "balloon"; balloonId: string; panelBox: Box; dx: number; dy: number; gesture: string }
  | { kind: "tail"; balloonId: string; panelBox: Box; gesture: string }
  | { kind: "gutter"; handle: GutterHandle; gesture: string };

let gestureCounter = 0;

/**
 * La pagina renderizzata con sopra uno strato di maniglie: pannelli da
 * selezionare, balloon e code da trascinare, gutter da spostare. L'SVG sotto
 * è esattamente quello che produce il Core — le maniglie usano la sua stessa
 * geometria (`balloonBox`, `gutterHandles`), quindi si afferra ciò che si
 * vede. Ogni trascinamento è un solo passo di undo.
 */
export function PageEditor(props: Props) {
  const { page, svg, boxes, fits, width, height, selectedPanelId, selectedBalloonId, run, endGesture } = props;
  const overlay = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  if (!svg) return <p className="muted">Nessuna anteprima: il lay-out non è in modalità "page".</p>;

  /** Dal puntatore alle coordinate della pagina, qualunque sia lo zoom dell'anteprima. */
  function toPage(event: ReactPointerEvent): { x: number; y: number } {
    const svgEl = overlay.current!;
    const matrix = svgEl.getScreenCTM()!.inverse();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }

  function begin(event: ReactPointerEvent, next: Drag) {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setDrag(next);
  }

  function onMove(event: ReactPointerEvent) {
    if (!drag) return;
    const p = toPage(event);
    if (drag.kind === "balloon") {
      const anchor = anchorFor(p.x - drag.dx, p.y - drag.dy, drag.panelBox);
      run({ type: "balloon.move", pageId: page.id, balloonId: drag.balloonId, anchor }, { gesture: drag.gesture });
    } else if (drag.kind === "tail") {
      const target = { x: (p.x - drag.panelBox.x) / drag.panelBox.width, y: (p.y - drag.panelBox.y) / drag.panelBox.height };
      const clamped = { x: Math.min(1, Math.max(0, target.x)), y: Math.min(1, Math.max(0, target.y)) };
      run({ type: "balloon.tail", pageId: page.id, balloonId: drag.balloonId, tail: { mode: "manual", target: clamped } }, { gesture: drag.gesture });
    } else if (page.layout.mode === "page") {
      const { axis, index } = drag.handle;
      const weights = page.layout[axis];
      const content = primaryGeometry.content;
      const gutter = axis === "cols" ? page.layout.gutter.x * primaryGeometry.scale : page.layout.gutter.y * primaryGeometry.scale;
      const available = (axis === "cols" ? content.width : content.height) - gutter * (weights.length - 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const sizes = weights.map((w) => (w / total) * available);
      const start = (axis === "cols" ? content.x : content.y) + sizes.slice(0, index).reduce((a, b) => a + b, 0) + gutter * index;
      const pair = sizes[index]! + sizes[index + 1]!;
      const next = dragTrackBoundary(weights, index, start, pair, axis === "cols" ? p.x : p.y, gutter);
      run({ type: "layout.tracks", pageId: page.id, [axis]: next }, { gesture: drag.gesture });
    }
  }

  function onUp() {
    if (!drag) return;
    setDrag(null);
    endGesture();
  }

  const selected = boxes.get(selectedPanelId);
  const handles = gutterHandles(page, boxes);
  const balloons = page.panels.flatMap((panel) => {
    const panelBox = boxes.get(panel.id);
    if (!panelBox) return [];
    return panel.balloons.flatMap((balloon) => {
      const fit = fits.get(balloon.id);
      if (!fit) return [];
      const box = balloonBox(balloon, panelBox, fit);
      return [{ balloon, panel, panelBox, box, tail: tailPoint(balloon, panelBox, box) }];
    });
  });
  const active = balloons.find((b) => b.balloon.id === selectedBalloonId);
  const hasTail = (type: string) => type !== "caption" && type !== "sfx";

  return (
    <>
      {props.staleNote && <p className="preview__note">Mostra l'ultima versione valida: le modifiche non valide non sono applicate.</p>}
      <div className={`preview${drag ? " preview--dragging" : ""}`}>
        <div className="preview__page" dangerouslySetInnerHTML={{ __html: svg }} />
        <svg
          ref={overlay}
          className="preview__overlay"
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {[...boxes.entries()].map(([panelId, box]) => (
            <rect
              key={panelId}
              className="preview__hit"
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              onClick={() => props.onSelectPanel(panelId)}
            >
              <title>{panelId}</title>
            </rect>
          ))}
          {selected && <rect className="preview__selected" x={selected.x} y={selected.y} width={selected.width} height={selected.height} />}

          {handles.map((h, i) => (
            <line
              key={`${h.axis}-${h.index}-${i}`}
              className={`gutter-handle gutter-handle--${h.axis}`}
              x1={h.x1}
              y1={h.y1}
              x2={h.x2}
              y2={h.y2}
              onPointerDown={(e) => begin(e, { kind: "gutter", handle: h, gesture: `gutter-${++gestureCounter}` })}
            >
              <title>Trascina per spostare il gutter</title>
            </line>
          ))}

          {balloons.map(({ balloon, panel, panelBox, box }) => (
            <rect
              key={balloon.id}
              className={`balloon-hit${balloon.id === selectedBalloonId ? " balloon-hit--selected" : ""}`}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={8}
              onPointerDown={(e) => {
                const p = toPage(e);
                props.onSelectBalloon(balloon.id, panel.id);
                begin(e, { kind: "balloon", balloonId: balloon.id, panelBox, dx: p.x - box.x, dy: p.y - box.y, gesture: `balloon-${++gestureCounter}` });
              }}
            >
              <title>{`${balloon.id}: trascina per spostare`}</title>
            </rect>
          ))}

          {active && hasTail(active.balloon.type) && active.balloon.tail.mode !== "none" && (
            <circle
              className="tail-handle"
              cx={active.tail.x}
              cy={active.tail.y}
              r={12}
              onPointerDown={(e) => begin(e, { kind: "tail", balloonId: active.balloon.id, panelBox: active.panelBox, gesture: `tail-${++gestureCounter}` })}
            >
              <title>Trascina la punta della coda verso chi parla</title>
            </circle>
          )}
        </svg>
      </div>
    </>
  );
}
