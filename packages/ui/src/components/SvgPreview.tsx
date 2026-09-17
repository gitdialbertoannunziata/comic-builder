import type { Box } from "@comic-builder/core";

interface Props {
  svg: string | null;
  boxes: Map<string, Box>;
  width: number;
  height: number;
  selectedPanelId: string;
  onSelectPanel: (panelId: string) => void;
  staleNote?: boolean;
}

/**
 * La pagina renderizzata più uno strato di bersagli trasparenti sopra: si
 * seleziona un pannello indicandolo sulla pagina, non cercandolo in un elenco.
 * L'SVG sotto resta esattamente quello che produce il Core — nessuna variante
 * "per la UI" che potrebbe divergere da ciò che poi si esporta.
 */
export function SvgPreview({
  svg,
  boxes,
  width,
  height,
  selectedPanelId,
  onSelectPanel,
  staleNote,
}: Props) {
  if (!svg) {
    return <p className="muted">Nessuna anteprima: il lay-out non è in modalità "page".</p>;
  }

  const selected = boxes.get(selectedPanelId);

  return (
    <>
      {staleNote && (
        <p className="preview__note">
          Mostra l'ultima versione valida: le modifiche non valide non sono applicate.
        </p>
      )}
      <div className="preview">
        <div className="preview__page" dangerouslySetInnerHTML={{ __html: svg }} />
        <svg className="preview__overlay" viewBox={`0 0 ${width} ${height}`} aria-hidden="false">
          {[...boxes.entries()].map(([panelId, box]) => (
            <rect
              key={panelId}
              className="preview__hit"
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              onClick={() => onSelectPanel(panelId)}
            >
              <title>{panelId}</title>
            </rect>
          ))}
          {selected && (
            <rect
              className="preview__selected"
              x={selected.x}
              y={selected.y}
              width={selected.width}
              height={selected.height}
            />
          )}
        </svg>
      </div>
    </>
  );
}
