import { t } from "../i18n.js";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  artPlacement,
  anchorFor,
  balloonBox,
  dragTrackBoundary,
  gutterHandles,
  rotatePoint,
  shownArt,
  shownArtPatch,
  tailPoint,
  type Box,
  type Command,
  type GutterHandle,
  type LetteringFit,
  type Page,
  type Tail,
} from "@comic-builder/core";
import { primaryGeometry, primaryTarget } from "../project.js";

interface Props {
  page: Page;
  /** La pagina com'è nel formato mostrato: le ancore dei balloon includono gli override. */
  shownPage: Page;
  /** Formato mostrato; se non è il principale, si spostano solo i balloon, come override. */
  targetId: string;
  primary: boolean;
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
  /** Pannello di cui si sta inquadrando l'arte: trascinare la sposta, la rotella la ingrandisce. */
  framingPanelId?: string | null;
  /** Immagini trascinate sulla pagina: con il pannello su cui sono cadute, se ce n'è uno. */
  onDropFiles?: (files: File[], panelId: string | null) => void;
}

type Drag =
  | { kind: "balloon"; balloonId: string; panelBox: Box; dx: number; dy: number; gesture: string }
  | { kind: "tail"; balloonId: string; panelBox: Box; tail: Tail; gesture: string }
  | { kind: "resize"; balloonId: string; panelBox: Box; box: Box; rotation: number; handle: ResizeHandle; gesture: string }
  | { kind: "rotate"; balloonId: string; center: { x: number; y: number }; gesture: string }
  | { kind: "gutter"; handle: GutterHandle; gesture: string }
  | { kind: "art"; panelId: string; startX: number; startY: number; focusX: number; focusY: number; width: number; height: number; gesture: string };

let gestureCounter = 0;

/** Una maniglia di ridimensionamento: da che lato si tira, in orizzontale e in verticale (0 = quel lato resta fermo). */
interface ResizeHandle {
  id: string;
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
}

const RESIZE_HANDLES: readonly ResizeHandle[] = [
  { id: "nw", sx: -1, sy: -1 },
  { id: "n", sx: 0, sy: -1 },
  { id: "ne", sx: 1, sy: -1 },
  { id: "e", sx: 1, sy: 0 },
  { id: "se", sx: 1, sy: 1 },
  { id: "s", sx: 0, sy: 1 },
  { id: "sw", sx: -1, sy: 1 },
  { id: "w", sx: -1, sy: 0 },
];

/** Il balloon più piccolo che si può tirare a mano, in px di pagina: sotto, non lo si riafferra più. */
const MIN_BALLOON_PX = 32;

/**
 * Il box dopo aver tirato una maniglia fino a `p`. Si ragiona nel sistema
 * del balloon non ruotato: lì il lato opposto resta fermo. Poi il nuovo
 * centro torna nella pagina ruotando attorno al centro di partenza, così
 * anche un balloon storto si allarga dal lato che si tira, senza scivolare.
 */
function resizedBox(start: Box, rotation: number, handle: ResizeHandle, p: { x: number; y: number }, keepRatio: boolean): Box {
  const center = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const local = rotatePoint(p, center, -rotation);
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  if (handle.sx < 0) left = Math.min(local.x, right - MIN_BALLOON_PX);
  if (handle.sx > 0) right = Math.max(local.x, left + MIN_BALLOON_PX);
  if (handle.sy < 0) top = Math.min(local.y, bottom - MIN_BALLOON_PX);
  if (handle.sy > 0) bottom = Math.max(local.y, top + MIN_BALLOON_PX);
  if (keepRatio && handle.sx !== 0 && handle.sy !== 0) {
    // Shift su un angolo: si tiene la proporzione, e comanda il lato che si è allungato di più.
    const factor = Math.max((right - left) / start.width, (bottom - top) / start.height);
    const width = start.width * factor;
    const height = start.height * factor;
    if (handle.sx < 0) left = right - width;
    else right = left + width;
    if (handle.sy < 0) top = bottom - height;
    else bottom = top + height;
  }
  const localCenter = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const pageCenter = rotatePoint(localCenter, center, rotation);
  const width = right - left;
  const height = bottom - top;
  return { x: pageCenter.x - width / 2, y: pageCenter.y - height / 2, width, height };
}

/** L'angolo del puntatore attorno al centro, con 0° in alto; Shift scatta ogni 15°. */
function rotationFor(center: { x: number; y: number }, p: { x: number; y: number }, snap: boolean): number {
  let degrees = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI + 90;
  if (degrees > 180) degrees -= 360;
  degrees = snap ? Math.round(degrees / 15) * 15 : Math.round(degrees);
  // Vicino a dritto è dritto: raddrizzare a occhio non deve lasciare un balloon storto di un grado.
  if (Math.abs(degrees) <= 2) degrees = 0;
  return degrees === -180 ? 180 : degrees;
}

/**
 * La pagina renderizzata con sopra uno strato di maniglie: pannelli da
 * selezionare, balloon e code da trascinare, gutter da spostare. L'SVG sotto
 * è esattamente quello che produce il Core — le maniglie usano la sua stessa
 * geometria (`balloonBox`, `gutterHandles`), quindi si afferra ciò che si
 * vede. Ogni trascinamento è un solo passo di undo.
 */
export function PageEditor(props: Props) {
  const { page, shownPage, targetId, primary, svg, boxes, fits, width, height, selectedPanelId, selectedBalloonId, run, endGesture } = props;
  // Fuori dal formato principale ogni spostamento è un override per quel formato.
  const forTarget = primary ? {} : { target: targetId };
  const overlay = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropPanel, setDropPanel] = useState<string | null | undefined>(undefined);

  // Il pannello in inquadratura, con l'immagine che mostra (arte dell'autore o render) e dove sta ora.
  const framed = (() => {
    const id = props.framingPanelId;
    if (!id) return null;
    const panel = page.panels.find((p) => p.id === id);
    const box = boxes.get(id);
    const shown = panel ? shownArt(panel, primaryTarget.id) : null;
    if (!panel || !shown?.size || !box) return null;
    const frame = { fit: "cover" as const, zoom: 1, focus_x: 0.5, focus_y: 0.5, ...shown.frame };
    return { panel, box, frame, placement: artPlacement(box, shown.size, frame) };
  })();

  // La rotella serve un ascoltatore non passivo, o la colonna scorre mentre
  // si ingrandisce. Le ultime informazioni passano da un ref.
  const framedRef = useRef(framed);
  framedRef.current = framed;
  useEffect(() => {
    const el = overlay.current;
    if (!el || !props.framingPanelId) return;
    const onWheel = (event: WheelEvent) => {
      const current = framedRef.current;
      if (!current) return;
      event.preventDefault();
      const zoom = Math.min(10, Math.max(0.1, current.frame.zoom * Math.exp(-event.deltaY * 0.0015)));
      const patch = shownArtPatch(current.panel, primaryTarget.id, { ...current.frame, zoom });
      // Un giro di rotella è un passo di undo: i passi vicini nel tempo si fondono.
      if (patch) run({ type: "panel.update", pageId: page.id, panelId: current.panel.id, patch }, { gesture: `art-wheel-${current.panel.id}-${Math.floor(Date.now() / 700)}` });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [props.framingPanelId, page.id, run, svg]);

  if (!svg) return <p className="muted">{t("Nessuna anteprima: il lay-out non è in modalità \"page\".")}</p>;

  /** Dal puntatore alle coordinate della pagina, qualunque sia lo zoom dell'anteprima. */
  function toPage(event: { clientX: number; clientY: number }): { x: number; y: number } {
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
      run({ type: "balloon.move", pageId: page.id, balloonId: drag.balloonId, anchor, ...forTarget }, { gesture: drag.gesture });
    } else if (drag.kind === "art") {
      const panel = page.panels.find((x) => x.id === drag.panelId);
      if (!panel) return;
      // Spostare il disegno a destra vuol dire portare al centro un punto più a sinistra.
      const focus_x = Math.min(1, Math.max(0, drag.focusX - (p.x - drag.startX) / drag.width));
      const focus_y = Math.min(1, Math.max(0, drag.focusY - (p.y - drag.startY) / drag.height));
      const frame = { fit: "cover" as const, zoom: 1, ...shownArt(panel, primaryTarget.id)?.frame, focus_x, focus_y };
      const patch = shownArtPatch(panel, primaryTarget.id, frame);
      if (patch) run({ type: "panel.update", pageId: page.id, panelId: panel.id, patch }, { gesture: drag.gesture });
    } else if (drag.kind === "tail") {
      const point = { x: (p.x - drag.panelBox.x) / drag.panelBox.width, y: (p.y - drag.panelBox.y) / drag.panelBox.height };
      const clamped = { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) };
      run({ type: "balloon.tail", pageId: page.id, balloonId: drag.balloonId, tail: { ...drag.tail, mode: "manual", target: clamped }, ...forTarget }, { gesture: drag.gesture });
    } else if (drag.kind === "resize") {
      const next = resizedBox(drag.box, drag.rotation, drag.handle, p, event.shiftKey);
      const size = { w: next.width / drag.panelBox.width, h: next.height / drag.panelBox.height };
      run(
        { type: "balloon.resize", pageId: page.id, balloonId: drag.balloonId, size, anchor: anchorFor(next.x, next.y, drag.panelBox), ...forTarget },
        { gesture: drag.gesture },
      );
    } else if (drag.kind === "rotate") {
      run({ type: "balloon.update", pageId: page.id, balloonId: drag.balloonId, patch: { rotation: rotationFor(drag.center, p, event.shiftKey) } }, { gesture: drag.gesture });
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

  /** Il pannello sotto il cursore durante un trascinamento di file. */
  function panelAt(event: ReactDragEvent): string | null {
    const p = toPage(event);
    for (const [id, box] of boxes) {
      if (p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height) return id;
    }
    return null;
  }

  const carriesFiles = (event: ReactDragEvent) => [...event.dataTransfer.types].includes("Files");

  function onUp() {
    if (!drag) return;
    setDrag(null);
    endGesture();
  }

  const selected = boxes.get(selectedPanelId);
  // La griglia si ritocca solo sul formato principale (§4.1 regola 2): negli
  // altri deriva, e trascinarne i gutter cambierebbe tutti i formati insieme.
  const handles = primary && !framed ? gutterHandles(page, boxes) : [];
  const tuned = new Set(page.panels.flatMap((p) => p.balloons).filter((b) => b.per_target[targetId]).map((b) => b.id));
  const balloons = shownPage.panels.flatMap((panel) => {
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
  /** La rotazione del balloon, come trasformazione SVG attorno al suo centro: le maniglie girano con lui. */
  const turn = (balloon: { rotation?: number | undefined }, box: Box) =>
    balloon.rotation ? `rotate(${balloon.rotation} ${box.x + box.width / 2} ${box.y + box.height / 2})` : undefined;

  return (
    <>
      {props.staleNote && <p className="preview__note">{t("Mostra l'ultima versione valida: le modifiche non valide non sono applicate.")}</p>}
      <div
        className={`preview${drag ? " preview--dragging" : ""}${dropPanel !== undefined ? " preview--dropping" : ""}`}
        onDragOver={(e) => {
          if (!props.onDropFiles || !carriesFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropPanel(panelAt(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropPanel(undefined);
        }}
        onDrop={(e) => {
          if (!props.onDropFiles || !carriesFiles(e)) return;
          e.preventDefault();
          const target = panelAt(e);
          setDropPanel(undefined);
          props.onDropFiles([...e.dataTransfer.files], target);
        }}
      >
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
          {dropPanel && boxes.get(dropPanel) && (
            <rect className="preview__drop" x={boxes.get(dropPanel)!.x} y={boxes.get(dropPanel)!.y} width={boxes.get(dropPanel)!.width} height={boxes.get(dropPanel)!.height} />
          )}

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
              <title>{t("Trascina per spostare il gutter")}</title>
            </line>
          ))}

          {framed && (
            <>
              <rect className="art-frame-outline" x={framed.placement.x} y={framed.placement.y} width={framed.placement.width} height={framed.placement.height} />
              <rect
                className="art-frame-hit"
                x={framed.box.x}
                y={framed.box.y}
                width={framed.box.width}
                height={framed.box.height}
                onPointerDown={(e) => {
                  const p = toPage(e);
                  begin(e, {
                    kind: "art",
                    panelId: framed.panel.id,
                    startX: p.x,
                    startY: p.y,
                    focusX: framed.frame.focus_x,
                    focusY: framed.frame.focus_y,
                    width: framed.placement.width,
                    height: framed.placement.height,
                    gesture: `art-pan-${++gestureCounter}`,
                  });
                }}
              >
                <title>{t("Trascina (o frecce) per spostare l'immagine, rotella (o + −) per ingrandire, Esc per finire")}</title>
              </rect>
            </>
          )}

          {!framed && balloons.map(({ balloon, panel, panelBox, box }) => (
            <rect
              key={balloon.id}
              className={`balloon-hit${balloon.id === selectedBalloonId ? " balloon-hit--selected" : ""}${!primary && tuned.has(balloon.id) ? " balloon-hit--tuned" : ""}`}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={8}
              transform={turn(balloon, box)}
              onPointerDown={(e) => {
                const p = toPage(e);
                props.onSelectBalloon(balloon.id, panel.id);
                begin(e, { kind: "balloon", balloonId: balloon.id, panelBox, dx: p.x - box.x, dy: p.y - box.y, gesture: `balloon-${++gestureCounter}` });
              }}
            >
              <title>{t("{0}: trascina per spostare{1}{2}", balloon.id, primary ? "" : ` (solo in ${targetId})`, !primary && tuned.has(balloon.id) ? " — già ritoccato qui" : "")}</title>
            </rect>
          ))}

          {!framed && active && hasTail(active.balloon.type) && active.balloon.tail.mode !== "none" && (
            <circle
              className="tail-handle"
              cx={active.tail.x}
              cy={active.tail.y}
              r={12}
              onPointerDown={(e) => begin(e, { kind: "tail", balloonId: active.balloon.id, panelBox: active.panelBox, tail: active.balloon.tail, gesture: `tail-${++gestureCounter}` })}
            >
              <title>{t("Trascina la punta della coda verso chi parla")}</title>
            </circle>
          )}

          {!framed && active && (
            <g transform={turn(active.balloon, active.box)}>
              <line
                className="rotate-handle__stem"
                x1={active.box.x + active.box.width / 2}
                y1={active.box.y}
                x2={active.box.x + active.box.width / 2}
                y2={active.box.y - 34}
              />
              <circle
                className="rotate-handle"
                cx={active.box.x + active.box.width / 2}
                cy={active.box.y - 34}
                r={9}
                onPointerDown={(e) =>
                  begin(e, {
                    kind: "rotate",
                    balloonId: active.balloon.id,
                    center: { x: active.box.x + active.box.width / 2, y: active.box.y + active.box.height / 2 },
                    gesture: `rotate-${++gestureCounter}`,
                  })
                }
              >
                <title>{t("Trascina per ruotare il balloon (Shift: a scatti di 15°)")}</title>
              </circle>
              {RESIZE_HANDLES.map((handle) => (
                <rect
                  key={handle.id}
                  className={`resize-handle resize-handle--${handle.id}`}
                  x={active.box.x + ((handle.sx + 1) / 2) * active.box.width - 6}
                  y={active.box.y + ((handle.sy + 1) / 2) * active.box.height - 6}
                  width={12}
                  height={12}
                  onPointerDown={(e) =>
                    begin(e, {
                      kind: "resize",
                      balloonId: active.balloon.id,
                      panelBox: active.panelBox,
                      box: active.box,
                      rotation: active.balloon.rotation ?? 0,
                      handle,
                      gesture: `resize-${++gestureCounter}`,
                    })
                  }
                >
                  <title>{t("Trascina per cambiare forma al balloon (Shift sugli angoli: in proporzione){0}", primary ? "" : ` — solo in ${targetId}`)}</title>
                </rect>
              ))}
            </g>
          )}
        </svg>
      </div>
    </>
  );
}
