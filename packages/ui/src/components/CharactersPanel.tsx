import { useEffect, useMemo, useState } from "react";
import {
  appearanceText,
  characterRefs,
  characterSheetPath,
  compileCharacterSheetSpec,
  SHEET_VIEWS,
  type CharacterPatch,
  type CharacterSheet,
  type Command,
  type ProjectDoc,
  type ProjectStore,
  type SheetView,
} from "@comic-builder/core";
import type { ImageService } from "@comic-builder/image";
import { makeService, serviceReady, specModel, type ImageConfig } from "./GenerateCard.js";
import { ReferenceImages } from "./ReferenceImages.js";
import { generateReference } from "../editor/generateArt.js";
import { listArrows } from "../keyboard.js";

interface Props {
  doc: ProjectDoc;
  /** Dove vanno le immagini: la cartella del progetto, o la memoria della scheda finché non c'è. */
  store: ProjectStore;
  /** Il servizio di immagini della sessione: lo stesso che genera le vignette. */
  image: ImageConfig;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Il personaggio da aprire, quando ci si arriva da una vignetta. */
  focus?: { ref: string; at: number } | null;
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

/**
 * Le schede personaggio (§5.1). Il documento conosce i personaggi per nome;
 * qui si dice com'è fatto ognuno, una volta per la serie. È ciò che le
 * istruzioni per i modelli esterni ripetono in ogni pannello, e ciò che
 * rende riconoscibile un personaggio da una vignetta all'altra.
 */
export function CharactersPanel({ doc, store, image, run, endGesture, focus = null }: Props) {
  const refs = useMemo(() => [...characterRefs(doc)].sort(), [doc]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (focus) setSelected(focus.ref);
  }, [focus]);
  const [newVariant, setNewVariant] = useState("");
  const ref = selected && refs.includes(selected) ? selected : null;
  const sheet = ref ? doc.characters[ref] : undefined;

  const upsert = (patch: CharacterPatch, field: string) => ref && run({ type: "character.upsert", ref, patch }, { gesture: `${ref}:${field}` });

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
        const path = characterSheetPath(spec, view);
        cost += (await generateReference({ store, service, spec, path })).costUsd;
        current = { ...current, references: [...current.references, { path, note: SHEET_VIEWS[view].label, use: true }] };
        run({ type: "character.upsert", ref, patch: { references: current.references } });
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
      <div className="character-list" onKeyDown={(e) => void listArrows(e)}>
        {refs.length === 0 && <p className="field__hint">Nessun personaggio: arrivano dallo spoglio del copione.</p>}
        {refs.map((r, i) => {
          const level = completeness(doc.characters[r]);
          return (
            <button
              key={r}
              type="button"
              className="character-chip"
              data-item
              tabIndex={r === ref || (ref === null && i === 0) ? 0 : -1}
              aria-pressed={r === ref}
              // Le frecce scelgono il vicino con un clic da tastiera (detail 0): solo un clic vero su quello già scelto lo chiude.
              onClick={(e) => setSelected(r === ref && e.detail > 0 ? null : r)}
              title={COMPLETENESS_LABEL[level]}
            >
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
            <ReferenceImages
              store={store}
              references={sheet?.references ?? []}
              onChange={(references) => ref && run({ type: "character.upsert", ref, patch: { references } })}
              directory={`characters/${ref}`}
              useHint="Se allegarla al modello quando si genera: tieni solo quelle in cui il personaggio è proprio lui"
            >
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={generating !== null || !describable || !serviceReady(image)}
                onClick={() => void generateSheet(["front", "three-quarter", "full-body"])}
                title="Fronte, tre quarti e figura intera, dall'aspetto scritto qui sopra e nello stile dell'opera"
              >
                Genera la scheda (3 viste)
              </button>
              {(Object.keys(SHEET_VIEWS) as SheetView[]).map((view) => (
                <button key={view} type="button" className="link-btn" disabled={generating !== null || !describable || !serviceReady(image)} onClick={() => void generateSheet([view])}>
                  + {SHEET_VIEWS[view].label}
                </button>
              ))}
            </ReferenceImages>
            {generating && <p className="muted">Genero {generating}…</p>}
            {sheetNote && <p className={`issue issue--${sheetNote.level}`}>{sheetNote.text}</p>}
            {!describable && <p className="field__hint">Per generare la scheda serve almeno un campo dell'aspetto: è da lì che il modello lo disegna.</p>}
            {describable && !serviceReady(image) && <p className="field__hint">Per generare serve il servizio di immagini configurato: Pagine → Arte → «servizio e spesa».</p>}
            <p className="field__hint">
              La scheda generata parte dall'aspetto scritto sopra e dalle tavole di stile dell'opera; ogni vista guarda quelle già spuntate, quindi tieni la prima che ti
              convince e genera le altre da lì. Quelle spuntate si allegano da sole quando generi una vignetta in cui compare: è ciò che lo tiene uguale da una all'altra.
              Bastano due o tre buone — fronte, tre quarti, figura intera.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
