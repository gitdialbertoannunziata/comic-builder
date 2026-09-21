import { useState } from "react";
import type { CharacterSheet, Command, Panel, PanelCharacter } from "@comic-builder/core";

interface Props {
  pageId: string;
  panel: Panel;
  refs: string[];
  sheets: Readonly<Record<string, CharacterSheet>>;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
}

const ROLES: Array<[PanelCharacter["role"], string]> = [
  ["lead", "protagonista"],
  ["support", "secondario"],
  ["background", "sfondo"],
];

const FRAMINGS: Array<[PanelCharacter["framing"], string]> = [
  ["full-body", "figura intera"],
  ["head-and-torso", "mezzo busto"],
  ["head-only", "solo testa"],
  ["hands-only", "solo mani"],
  ["silhouette", "silhouette"],
];

/**
 * Chi è in vignetta, e com'è in questo pannello: ruolo, inquadratura,
 * espressione, costume. Il costume si sceglie fra quelli della scheda —
 * scriverlo a mano è il modo più sicuro di ottenere «Notte» e «notte» come
 * due abiti diversi.
 */
export function PanelCharacters({ pageId, panel, refs, sheets, run, endGesture }: Props) {
  const [adding, setAdding] = useState("");
  const absent = refs.filter((r) => !panel.characters.some((c) => c.ref === r));

  function update(index: number, change: Partial<PanelCharacter>, field: string) {
    const characters = panel.characters.map((c, i) => (i === index ? { ...c, ...change } : c));
    run({ type: "panel.update", pageId, panelId: panel.id, patch: { characters } }, { gesture: `${panel.id}:cast:${field}` });
  }

  return (
    <div className="card">
      <p className="card__title">in vignetta</p>
      {panel.characters.length === 0 && <p className="field__hint">Nessuno: un luogo, un oggetto, un paesaggio.</p>}
      <div className="stack">
        {panel.characters.map((character, index) => {
          const sheet = sheets[character.ref];
          const variants = Object.keys(sheet?.wardrobe ?? {});
          const options = [...new Set(["default", ...variants, character.wardrobe])];
          return (
            <div key={character.ref} className="cast-row">
              <div className="cast-row__head">
                <strong>{sheet?.name || character.ref}</strong>
                {!sheet && <span className="field__hint">senza scheda</span>}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => run({ type: "panel.update", pageId, panelId: panel.id, patch: { characters: panel.characters.filter((_, i) => i !== index) } })}
                >
                  togli
                </button>
              </div>
              <div className="grid-2">
                <label className="field">
                  <span className="field__label">ruolo</span>
                  <select value={character.role} onChange={(e) => update(index, { role: e.target.value as PanelCharacter["role"] }, "role")}>
                    {ROLES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">inquadratura</span>
                  <select value={character.framing} onChange={(e) => update(index, { framing: e.target.value as PanelCharacter["framing"] }, "framing")}>
                    {FRAMINGS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">espressione</span>
                  <input type="text" value={character.expression} placeholder="tesa, sollevata…" onChange={(e) => update(index, { expression: e.target.value }, `expr-${character.ref}`)} onBlur={endGesture} />
                </label>
                <label className="field">
                  <span className="field__label">costume</span>
                  <select value={character.wardrobe} onChange={(e) => update(index, { wardrobe: e.target.value }, "wardrobe")}>
                    {options.map((value) => (
                      <option key={value} value={value}>
                        {value}
                        {sheet?.wardrobe[value] ? ` — ${sheet.wardrobe[value]}` : value !== "default" && variants.length > 0 && !sheet?.wardrobe[value] ? " (non nella scheda)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {absent.length > 0 && (
        <div className="tool-row">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">aggiungi un personaggio…</option>
            {absent.map((r) => (
              <option key={r} value={r}>
                {sheets[r]?.name || r}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--small"
            disabled={!adding}
            onClick={() => {
              const character: PanelCharacter = { ref: adding, weight: 0.5, role: panel.characters.length === 0 ? "lead" : "support", framing: "head-and-torso", expression: "", wardrobe: "default" };
              run({ type: "panel.update", pageId, panelId: panel.id, patch: { characters: [...panel.characters, character] } });
              setAdding("");
            }}
          >
            + in vignetta
          </button>
        </div>
      )}
    </div>
  );
}
