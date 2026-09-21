import type { Camera, Command, Page, Panel } from "@comic-builder/core";
import { SHOT_OPTIONS, SHOT_LABELS } from "../cameraOptions.js";

interface Props {
  page: Page;
  panel: Panel;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  onSelectPanel: (panelId: string) => void;
}

type Side = "sinistra" | "destra" | "sopra" | "sotto";

/** I vicini con cui il pannello forma un rettangolo: gli unici con cui si può unire. */
function mergeable(page: Page, panel: Panel): Array<{ side: Side; other: Panel }> {
  const a = panel.area;
  const out: Array<{ side: Side; other: Panel }> = [];
  for (const other of page.panels) {
    if (other.id === panel.id) continue;
    const b = other.area;
    const sameRows = a.row === b.row && a.row_span === b.row_span;
    const sameCols = a.col === b.col && a.col_span === b.col_span;
    if (sameRows && b.col + b.col_span === a.col) out.push({ side: "sinistra", other });
    if (sameRows && a.col + a.col_span === b.col) out.push({ side: "destra", other });
    if (sameCols && b.row + b.row_span === a.row) out.push({ side: "sopra", other });
    if (sameCols && a.row + a.row_span === b.row) out.push({ side: "sotto", other });
  }
  return out;
}

/**
 * Icona di un taglio d'inquadratura: la stessa figura, inquadrata più o meno
 * stretta. Si riconosce a colpo d'occhio, senza leggere la sigla.
 */
function ShotIcon({ shot }: { shot: Camera["shot"] }) {
  const W = 30;
  const H = 22;
  if (shot === "INSERT") {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="shot-icon" aria-hidden>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} className="shot-icon__frame" />
        <rect x={9} y={7} width={12} height={8} rx={1.5} className="shot-icon__fig" />
        <circle cx={15} cy={11} r={2} className="shot-icon__frame" />
      </svg>
    );
  }
  // Altezza della figura intera in frazioni del fotogramma: più stretto è il
  // taglio, più la figura esce dal fotogramma verso il basso.
  const scale: Record<string, number> = { EWS: 0.28, LS: 0.84, MLS: 1.35, MS: 2, MCU: 2.9, CU: 4.8, ECU: 9 };
  const figure = H * scale[shot]!;
  const head = figure / 7;
  // La testa resta in alto; nel dettaglio sugli occhi, gli occhi al centro.
  const headY = shot === "ECU" ? H / 2 : shot === "EWS" ? H - figure + head : Math.max(head + 1.5, 2 + head);
  const cx = W / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="shot-icon" aria-hidden>
      <clipPath id={`clip-${shot}`}>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} />
      </clipPath>
      <g clipPath={`url(#clip-${shot})`}>
        {shot === "EWS" && <line x1={0} y1={H - 3} x2={W} y2={H - 3} className="shot-icon__frame" />}
        <circle cx={cx} cy={headY} r={head} className="shot-icon__fig" />
        <rect x={cx - head * 1.3} y={headY + head * 1.2} width={head * 2.6} height={figure} rx={head * 0.8} className="shot-icon__fig" />
        {shot === "ECU" && (
          <>
            <circle cx={cx - head * 0.4} cy={headY} r={head * 0.12} className="shot-icon__eye" />
            <circle cx={cx + head * 0.4} cy={headY} r={head * 0.12} className="shot-icon__eye" />
          </>
        )}
      </g>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} className="shot-icon__frame" />
    </svg>
  );
}

export function PanelTools({ page, panel, run, onSelectPanel }: Props) {
  const neighbours = mergeable(page, panel);

  return (
    <div className="card">
      <p className="card__title">inquadratura rapida</p>
      <div className="shots" role="radiogroup" aria-label="Taglio dell'inquadratura">
        {SHOT_OPTIONS.map((shot) => (
          <button
            key={shot}
            type="button"
            role="radio"
            aria-checked={panel.camera.shot === shot}
            className="shot"
            title={`${shot} — ${SHOT_LABELS[shot]}`}
            onClick={() => run({ type: "panel.camera", pageId: page.id, panelId: panel.id, camera: { shot } })}
          >
            <ShotIcon shot={shot} />
            <span>{shot}</span>
          </button>
        ))}
      </div>

      <p className="card__title card__title--gap">griglia</p>
      <div className="tool-row">
        <button type="button" className="btn btn--small" onClick={() => run({ type: "panel.split", pageId: page.id, panelId: panel.id, axis: "cols" })} title="Due pannelli affiancati">
          ◫ dividi in verticale
        </button>
        <button type="button" className="btn btn--small" onClick={() => run({ type: "panel.split", pageId: page.id, panelId: panel.id, axis: "rows" })} title="Due pannelli uno sopra l'altro">
          ⊟ dividi in orizzontale
        </button>
      </div>
      {neighbours.length > 0 ? (
        <div className="tool-row">
          {neighbours.map(({ side, other }) => (
            <button
              key={other.id}
              type="button"
              className="btn btn--small"
              title={`Unisci con ${other.id}`}
              onClick={() => {
                if (run({ type: "panel.merge", pageId: page.id, panelIds: [panel.id, other.id] })) {
                  // Resta quello che si legge prima: la selezione lo segue.
                  const order = page.layout.mode === "page" ? page.layout.reading_order : [];
                  onSelectPanel(order.indexOf(panel.id) <= order.indexOf(other.id) ? panel.id : other.id);
                }
              }}
            >
              unisci a {side}
            </button>
          ))}
        </div>
      ) : (
        <p className="field__hint">Nessun vicino con cui formare un rettangolo: niente da unire.</p>
      )}
    </div>
  );
}
