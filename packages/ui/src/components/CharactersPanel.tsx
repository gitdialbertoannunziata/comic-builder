import { useEffect, useMemo, useRef, useState } from "react";
import { appearanceText, characterRefs, isArtFile, type CharacterPatch, type CharacterSheet, type Command, type ProjectDoc, type ProjectStore } from "@comic-builder/core";

interface Props {
  doc: ProjectDoc;
  store: ProjectStore | null;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
}

const APPEARANCE_FIELDS: Array<[keyof CharacterSheet["appearance"], string, string]> = [
  ["age", "età e genere", "woman in her 30s"],
  ["build", "corporatura", "tall, lean"],
  ["face", "viso", "angular face, thin lips"],
  ["hair", "capelli", "short black hair"],
  ["eyes", "occhi", "green eyes"],
  ["skin", "carnagione", "olive skin"],
  ["distinguishing", "segni particolari", "scar on left eyebrow, round glasses"],
];

/** Quanto la scheda basta a disegnare il personaggio: senza, ogni pannello lo reinventa. */
function completeness(sheet: CharacterSheet | undefined): "none" | "partial" | "full" {
  if (!sheet) return "none";
  const filled = Object.values(sheet.appearance).filter((v) => v.trim()).length;
  return filled >= 3 && Object.keys(sheet.wardrobe).length > 0 ? "full" : filled > 0 ? "partial" : "none";
}

const COMPLETENESS_LABEL = { none: "senza scheda", partial: "scheda incompleta", full: "scheda completa" } as const;

/** Anteprime delle immagini di riferimento, lette dalla cartella del progetto. */
function useReferenceUrls(store: ProjectStore | null, paths: readonly string[]): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  const key = paths.join("\n");
  useEffect(() => {
    if (!store) return;
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const map = new Map<string, string>();
      for (const path of paths) {
        const bytes = await store.readBytes(path);
        if (!bytes) continue;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
        created.push(url);
        map.set(path, url);
      }
      if (alive) setUrls(map);
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // `key` riassume `paths`: cambia solo quando cambiano i percorsi.
  }, [store, key]);
  return urls;
}

/**
 * Le schede personaggio (§5.1). Il documento conosce i personaggi per nome;
 * qui si dice com'è fatto ognuno, una volta per la serie. È ciò che le
 * istruzioni per i modelli esterni ripetono in ogni pannello, e ciò che
 * rende riconoscibile un personaggio da una vignetta all'altra.
 */
export function CharactersPanel({ doc, store, run, endGesture }: Props) {
  const refs = useMemo(() => [...characterRefs(doc)].sort(), [doc]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newVariant, setNewVariant] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ref = selected && refs.includes(selected) ? selected : null;
  const sheet = ref ? doc.characters[ref] : undefined;
  const urls = useReferenceUrls(store, sheet?.references.map((r) => r.path) ?? []);

  const upsert = (patch: CharacterPatch, field: string) => ref && run({ type: "character.upsert", ref, patch }, { gesture: `${ref}:${field}` });

  async function addReference(file: File) {
    if (!store || !ref) return;
    const path = `characters/${ref}/${file.name.replace(/[^\w.-]+/g, "_")}`;
    await store.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
    run({ type: "character.upsert", ref, patch: { references: [...(sheet?.references ?? []), { path, note: "" }] } });
  }

  return (
    <div className="stack">
      <div className="character-list">
        {refs.length === 0 && <p className="field__hint">Nessun personaggio: arrivano dallo spoglio del copione.</p>}
        {refs.map((r) => {
          const level = completeness(doc.characters[r]);
          return (
            <button key={r} type="button" className="character-chip" aria-pressed={r === ref} onClick={() => setSelected(r === ref ? null : r)} title={COMPLETENESS_LABEL[level]}>
              <span className={`dot dot--sheet-${level}`} />
              {doc.characters[r]?.name || r}
            </button>
          );
        })}
      </div>

      {ref && (
        <div className="card">
          <p className="card__title card__title--row">
            <span>
              scheda di <code>{ref}</code>
            </span>
            {sheet && (
              <button type="button" className="link-btn" onClick={() => run({ type: "character.remove", ref })} title="Toglie la scheda; il personaggio resta nei pannelli">
                togli la scheda
              </button>
            )}
          </p>
          <div className="stack">
            <label className="field">
              <span className="field__label">nome nella storia</span>
              <input type="text" value={sheet?.name ?? ""} placeholder="Sara Bellini" onChange={(e) => upsert({ name: e.target.value }, "name")} onBlur={endGesture} />
            </label>
            <label className="field">
              <span className="field__label">chi è (per te, non entra nelle istruzioni)</span>
              <input type="text" value={sheet?.summary ?? ""} placeholder="tecnica del faro, testarda" onChange={(e) => upsert({ summary: e.target.value }, "summary")} onBlur={endGesture} />
            </label>

            <p className="field__hint">L'aspetto va nelle istruzioni per i modelli: in inglese rende meglio, ma l'italiano funziona.</p>
            <div className="grid-2">
              {APPEARANCE_FIELDS.map(([field, label, placeholder]) => (
                <label key={field} className="field">
                  <span className="field__label">{label}</span>
                  <input
                    type="text"
                    value={sheet?.appearance[field] ?? ""}
                    placeholder={placeholder}
                    onChange={(e) => upsert({ appearance: { [field]: e.target.value } }, field)}
                    onBlur={endGesture}
                  />
                </label>
              ))}
              <label className="field">
                <span className="field__label">palette</span>
                <input type="text" value={sheet?.palette ?? ""} placeholder="slate grey, rust orange" onChange={(e) => upsert({ palette: e.target.value }, "palette")} onBlur={endGesture} />
              </label>
            </div>
            {sheet && appearanceText(sheet) && (
              <p className="field__hint">
                Nelle istruzioni: <em>{appearanceText(sheet)}</em>
              </p>
            )}

            <span className="field__label">costumi</span>
            {Object.entries(sheet?.wardrobe ?? {}).map(([variant, text]) => (
              <div key={variant} className="wardrobe-row">
                <code>{variant}</code>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => upsert({ wardrobe: { ...sheet!.wardrobe, [variant]: e.target.value } }, `wardrobe-${variant}`)}
                  onBlur={endGesture}
                />
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => upsert({ wardrobe: Object.fromEntries(Object.entries(sheet!.wardrobe).filter(([k]) => k !== variant)) }, "wardrobe-remove")}
                >
                  togli
                </button>
              </div>
            ))}
            <div className="wardrobe-row">
              <input type="text" value={newVariant} placeholder={Object.keys(sheet?.wardrobe ?? {}).length === 0 ? "default" : "notte, divisa…"} onChange={(e) => setNewVariant(e.target.value)} />
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  const name = (newVariant.trim() || "default").toLowerCase();
                  if (sheet?.wardrobe[name] !== undefined) return;
                  upsert({ wardrobe: { ...(sheet?.wardrobe ?? {}), [name]: "" } }, "wardrobe-add");
                  endGesture();
                  setNewVariant("");
                }}
              >
                + costume
              </button>
            </div>

            <span className="field__label">immagini di riferimento</span>
            {!store ? (
              <p className="field__hint">Le immagini vivono nella cartella del progetto: salva prima il progetto in una cartella.</p>
            ) : (
              <>
                <div className="reference-grid">
                  {(sheet?.references ?? []).map((r) => (
                    <figure key={r.path} className="reference">
                      {urls.get(r.path) ? <img src={urls.get(r.path)} alt="" /> : <span className="art-thumb art-thumb--missing">?</span>}
                      <figcaption>
                        {r.path.split("/").pop()}{" "}
                        <button type="button" className="link-btn" onClick={() => upsert({ references: sheet!.references.filter((x) => x.path !== r.path) }, "references")}>
                          togli
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
                  + immagine…
                </button>
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file && isArtFile(file.name)) void addReference(file);
                  }}
                />
                <p className="field__hint">Da allegare a mano ai modelli che accettano immagini: il brief le elenca.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
