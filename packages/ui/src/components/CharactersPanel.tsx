import { useEffect, useMemo, useRef, useState } from "react";
import {
  appearanceText,
  artMediaType,
  characterRefs,
  characterSheetPath,
  compileCharacterSheetSpec,
  isArtFile,
  SHEET_VIEWS,
  type CharacterPatch,
  type CharacterSheet,
  type Command,
  type ProjectDoc,
  type ProjectStore,
  type SheetView,
} from "@comic-builder/core";
import { runRenderQueue, type ImageService, type ReferenceImage } from "@comic-builder/image";
import { makeService, serviceReady, specModel, type ImageConfig } from "./GenerateCard.js";

interface Props {
  doc: ProjectDoc;
  /** Dove vanno le immagini: la cartella del progetto, o la memoria della scheda finché non c'è. */
  store: ProjectStore;
  /** Il servizio di immagini della sessione: lo stesso che genera le vignette. */
  image: ImageConfig;
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
function useReferenceUrls(store: ProjectStore, paths: readonly string[]): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  const key = paths.join("\n");
  useEffect(() => {
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
export function CharactersPanel({ doc, store, image, run, endGesture }: Props) {
  const refs = useMemo(() => [...characterRefs(doc)].sort(), [doc]);
  const [selected, setSelected] = useState<string | null>(null);
  const [newVariant, setNewVariant] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ref = selected && refs.includes(selected) ? selected : null;
  const sheet = ref ? doc.characters[ref] : undefined;
  const urls = useReferenceUrls(store, sheet?.references.map((r) => r.path) ?? []);

  const upsert = (patch: CharacterPatch, field: string) => ref && run({ type: "character.upsert", ref, patch }, { gesture: `${ref}:${field}` });

  async function addReference(file: File) {
    if (!ref) return;
    const path = `characters/${ref}/${file.name.replace(/[^\w.-]+/g, "_")}`;
    await store.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
    run({ type: "character.upsert", ref, patch: { references: [...(sheet?.references ?? []), { path, note: "", use: true }] } });
  }

  const [generating, setGenerating] = useState<string | null>(null);
  const [sheetNote, setSheetNote] = useState<{ level: "info" | "error"; text: string } | null>(null);
  const describable = sheet !== undefined && appearanceText(sheet).length > 0;

  /**
   * Genera viste della scheda (F5), una dopo l'altra: ognuna si aggiunge ai
   * riferimenti appena arriva, e la successiva la guarda. È questo ordine
   * che fa della scheda una persona sola invece di tre sosia.
   */
  async function generateSheet(views: readonly SheetView[]) {
    if (!ref || !sheet) return;
    setSheetNote(null);
    let service: ImageService;
    try {
      service = makeService(image);
    } catch (cause) {
      setSheetNote({ level: "error", text: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    let current = sheet;
    let cost = 0;
    let made = 0;
    try {
      for (const view of views) {
        setGenerating(`${SHEET_VIEWS[view].label} (${made + 1}/${views.length})`);
        const spec = compileCharacterSheetSpec({ project: doc.project, sheet: current, view, model: specModel(image) });
        const references: ReferenceImage[] = [];
        for (const reference of spec.references) {
          const data = await store.readBytes(reference.path);
          if (!data) throw new Error(`Riferimento non trovato: ${reference.path}. Toglilo dalla scheda, o rimetti il file.`);
          references.push({ path: reference.path, data, mediaType: artMediaType(reference.path) ?? "image/png" });
        }
        // Un lavoro per volta, ma dalla coda: è lei che aspetta il limite al minuto e riprova.
        const [outcome] = await runRenderQueue([{ id: view, request: () => ({ spec, references }) }], { service, retries: 5 });
        if (!outcome || outcome.status !== "done") throw new Error(outcome?.status === "failed" ? outcome.error : "Generazione interrotta.");
        const path = characterSheetPath(spec, view);
        await store.writeBytes(path, outcome.result.data);
        current = { ...current, references: [...current.references, { path, note: SHEET_VIEWS[view].label, use: true }] };
        run({ type: "character.upsert", ref, patch: { references: current.references } });
        cost += outcome.result.meta.costUsd ?? 0;
        made++;
      }
      setSheetNote({
        level: "info",
        text: `${made} ${made === 1 ? "immagine aggiunta" : "immagini aggiunte"} ai riferimenti${cost > 0 ? ` · addebitati ${cost.toFixed(2).replace(".", ",")} $` : ""}. Togli la spunta a quelle che non gli somigliano.`,
      });
    } catch (cause) {
      setSheetNote({ level: "error", text: `${made > 0 ? `${made} fatte, poi: ` : ""}${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setGenerating(null);
    }
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
            {(
              <>
                <div className="reference-grid">
                  {(sheet?.references ?? []).map((r) => (
                    <figure key={r.path} className="reference">
                      {urls.get(r.path) ? <img src={urls.get(r.path)} alt="" /> : <span className="art-thumb art-thumb--missing">?</span>}
                      <figcaption>
                        {r.path.split("/").pop()}{" "}
                        <label title="Se allegarla al modello quando si genera: tieni solo quelle in cui il personaggio è proprio lui">
                          <input
                            type="checkbox"
                            checked={r.use}
                            onChange={(e) => upsert({ references: sheet!.references.map((x) => (x.path === r.path ? { ...x, use: e.target.checked } : x)) }, "references")}
                          />{" "}
                          per generare
                        </label>{" "}
                        <button type="button" className="link-btn" onClick={() => upsert({ references: sheet!.references.filter((x) => x.path !== r.path) }, "references")}>
                          togli
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <div className="tool-row">
                  <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
                    + immagine…
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={generating !== null || !describable || !serviceReady(image)}
                    onClick={() => void generateSheet(["front", "three-quarter", "full-body"])}
                    title="Fronte, tre quarti e figura intera, dall'aspetto scritto qui sopra e nello stile del progetto"
                  >
                    Genera la scheda (3 viste)
                  </button>
                  {(Object.keys(SHEET_VIEWS) as SheetView[]).map((view) => (
                    <button key={view} type="button" className="link-btn" disabled={generating !== null || !describable || !serviceReady(image)} onClick={() => void generateSheet([view])}>
                      + {SHEET_VIEWS[view].label}
                    </button>
                  ))}
                </div>
                {generating && <p className="muted">Genero {generating}…</p>}
                {sheetNote && <p className={`issue issue--${sheetNote.level}`}>{sheetNote.text}</p>}
                {!describable && <p className="field__hint">Per generare la scheda serve almeno un campo dell'aspetto: è da lì che il modello lo disegna.</p>}
                {describable && !serviceReady(image) && <p className="field__hint">Per generare serve il servizio di immagini configurato: Pagine → Arte → «servizio e spesa».</p>}
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
                <p className="field__hint">
                  La scheda generata parte dall'aspetto scritto sopra; ogni vista guarda quelle già spuntate, quindi tieni la prima che ti convince e genera le altre da lì.
                  Quelle spuntate si allegano da sole quando generi una vignetta in cui compare (al massimo otto per vignetta, divise fra i personaggi): è ciò che lo tiene uguale
                  da una all'altra. Bastano due o tre buone — fronte, tre quarti, figura intera.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
