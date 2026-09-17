import { useEffect, useMemo, useState } from "react";
import { PageSchema, type Page, type Panel, type Balloon } from "@comic-builder/core";
import { useFont } from "./useFont.js";
import { renderPreview } from "./renderPreview.js";
import { initialPages, initialScene } from "./samplePage.js";
import { CameraForm } from "./components/CameraForm.js";
import { BalloonEditor } from "./components/BalloonEditor.js";
import { ValidationPanel } from "./components/ValidationPanel.js";
import { SvgPreview } from "./components/SvgPreview.js";

function updatePanel(page: Page, panelId: string, updater: (panel: Panel) => Panel): Page {
  return { ...page, panels: page.panels.map((p) => (p.id === panelId ? updater(p) : p)) };
}

function updateBalloon(panel: Panel, balloonId: string, updater: (balloon: Balloon) => Balloon): Panel {
  return { ...panel, balloons: panel.balloons.map((b) => (b.id === balloonId ? updater(b) : b)) };
}

export function App() {
  const [pages, setPages] = useState<Page[]>(initialPages);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedPanelId, setSelectedPanelId] = useState<string>(initialPages[0]!.panels[0]!.id);
  const [lastValidPage, setLastValidPage] = useState<Page>(initialPages[0]!);

  const { font, error: fontError } = useFont("/fonts/ComicNeue-Regular.ttf");

  const page = pages[pageIndex]!;

  const parsed = useMemo(() => PageSchema.safeParse(page), [page]);
  const schemaIssues = parsed.success ? [] : parsed.error.issues;

  useEffect(() => {
    if (parsed.success) setLastValidPage(parsed.data);
  }, [parsed]);

  const preview = useMemo(() => {
    if (!font) return null;
    return renderPreview(lastValidPage, font, initialScene);
  }, [lastValidPage, font]);

  const selectedPanel = page.panels.find((p) => p.id === selectedPanelId) ?? page.panels[0]!;

  function patchSelectedPanel(updater: (panel: Panel) => Panel) {
    setPages((prev) =>
      prev.map((p, i) => (i === pageIndex ? updatePanel(p, selectedPanel.id, updater) : p)),
    );
  }

  function goToPage(index: number) {
    setPageIndex(index);
    setSelectedPanelId(pages[index]!.panels[0]!.id);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 380px 1fr", gap: 16, padding: 16, height: "100%" }}>
      <aside>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#666" }}>Pagine</h2>
        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {pages.map((p, i) => (
            <button
              key={p.id}
              onClick={() => goToPage(i)}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid " + (i === pageIndex ? "#3a5a99" : "#ddd"),
                background: i === pageIndex ? "#eaf1fb" : "white",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {p.id}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
          template <strong>{page.layout.mode === "page" ? page.layout.template_id : "—"}</strong>, scelto dal
          catalogo in base ai beat
        </p>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#666" }}>Pannelli</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {page.panels.map((panel) => (
            <li key={panel.id}>
              <button
                onClick={() => setSelectedPanelId(panel.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid " + (panel.id === selectedPanelId ? "#3a5a99" : "#ddd"),
                  background: panel.id === selectedPanelId ? "#eaf1fb" : "white",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{panel.id}</div>
                <div style={{ color: "#777", fontSize: 12 }}>{panel.camera.shot} · {panel.action.slice(0, 28)}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", margin: 0 }}>
          {selectedPanel.id}
        </h2>

        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: "#444" }}>action</span>
          <textarea
            value={selectedPanel.action}
            rows={2}
            onChange={(e) => {
              const value = e.target.value;
              patchSelectedPanel((panel) => ({ ...panel, action: value }));
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: "#444" }}>setting</span>
          <input
            value={selectedPanel.setting}
            onChange={(e) => {
              const value = e.target.value;
              patchSelectedPanel((panel) => ({ ...panel, setting: value }));
            }}
          />
        </label>

        <div>
          <h3 style={{ fontSize: 13, color: "#666", margin: "0 0 6px" }}>camera</h3>
          <CameraForm
            camera={selectedPanel.camera}
            onChange={(camera) => patchSelectedPanel((panel) => ({ ...panel, camera }))}
          />
        </div>

        {selectedPanel.balloons.length > 0 && (
          <div>
            <h3 style={{ fontSize: 13, color: "#666", margin: "0 0 6px" }}>balloon</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedPanel.balloons.map((balloon) => (
                <BalloonEditor
                  key={balloon.id}
                  balloon={balloon}
                  onChange={(updated) =>
                    patchSelectedPanel((panel) => updateBalloon(panel, balloon.id, () => updated))
                  }
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
        {/* La validazione sta sopra l'anteprima: l'SVG è alto, e un errore
            sotto la piega non sarebbe "visibile" come chiede il criterio di F0.5. */}
        <div>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", margin: "0 0 8px" }}>
            Validazione
          </h2>
          <ValidationPanel schemaIssues={schemaIssues} docIssues={preview?.issues ?? []} />
        </div>

        <div>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", margin: "0 0 8px" }}>
            Anteprima
          </h2>
          {fontError && <p style={{ color: "#b3261e", fontSize: 13 }}>Font non caricato: {fontError}</p>}
          {!font && !fontError && <p style={{ color: "#888", fontSize: 13 }}>Carico il font…</p>}
          {schemaIssues.length > 0 && (
            <p style={{ color: "#8a6100", fontSize: 12.5, margin: "0 0 6px" }}>
              Mostra l'ultima versione valida: le modifiche non valide qui sopra non sono applicate.
            </p>
          )}
          <SvgPreview svg={preview?.svg ?? null} />
        </div>
      </section>
    </div>
  );
}
