import { useEffect, useMemo, useRef, useState } from "react";
import { compileLocationSpec, LocationSheetSchema, locationSheetPath, projectLocations, type Command, type LocationPatch, type ProjectDoc, type ProjectLocation, type ProjectStore } from "@comic-builder/core";
import type { BreakdownPlace, PlaceToDescribe } from "@comic-builder/llm";
import { makeService, serviceReady, specModel, type ImageConfig } from "./GenerateCard.js";
import { ReferenceImages } from "./ReferenceImages.js";
import { generateReference } from "../editor/generateArt.js";
import { listArrows } from "../keyboard.js";
import { useGeneration } from "../useGeneration.js";

interface Props {
  doc: ProjectDoc;
  store: ProjectStore;
  image: ImageConfig;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  /** Il modello linguistico scelto nel Copione, per proporre le descrizioni che mancano. */
  describe: (places: readonly PlaceToDescribe[]) => Promise<BreakdownPlace[]>;
  /** Chi lo farebbe, per l'etichetta del bottone: «claude», «euristico»… */
  describer: string;
  describeService: string;
  /** Il luogo da aprire, quando ci si arriva da una vignetta. */
  focus: { ref: string; at: number } | null;
}

/** Ciò che serve al modello per descrivere un luogo: le scene ambientate lì, in breve. */
function toDescribe(location: ProjectLocation): PlaceToDescribe {
  return { name: location.name, scenes: location.scenes.map((s) => ({ title: s.title, time_of_day: s.time_of_day, beats: s.beats.map((b) => b.summary) })) };
}

/** Quanto la scheda basta a disegnare il luogo: descrizione e immagini. */
function completeness(location: ProjectLocation): "none" | "partial" | "full" {
  const described = (location.sheet?.description.trim().length ?? 0) > 0;
  const shown = location.sheet?.references.some((r) => r.use) ?? false;
  return described && shown ? "full" : described || shown ? "partial" : "none";
}

const COMPLETENESS_LABEL = { none: "né descrizione né immagini: ogni vignetta lo reinventa", partial: "scheda incompleta", full: "descritto, con immagini" } as const;
const usd = (value: number) => `${value.toFixed(2).replace(".", ",")} $`;

/**
 * Le schede dei luoghi. Le scene dicono dove siamo; qui si dice com'è fatto
 * il posto, una volta per la serie. La descrizione va in ogni vignetta
 * ambientata lì, le immagini spuntate le si allegano: è ciò che tiene la
 * finestra dallo stesso lato e la scrivania della stessa forma.
 */
export function LocationsPanel({ doc, store, image, run, endGesture, describe, describer, describeService, focus }: Props) {
  const locations = useMemo(() => projectLocations(doc), [doc]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (focus) setSelected(focus.ref);
  }, [focus]);
  const location = locations.find((l) => l.ref === selected) ?? locations[0] ?? null;
  const sheet = location?.sheet ?? null;

  // Il documento di adesso, non quello di quando la richiesta è partita: nel frattempo l'autore può aver scritto.
  const latest = useRef(doc);
  latest.current = doc;
  const generation = useGeneration(store, doc.project.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ level: "info" | "error"; text: string } | null>(null);
  const undescribed = locations.filter((l) => !l.sheet?.description.trim());
  const descriptionScope = useGeneration(store, doc.project.id);
  useEffect(() => { setBusy(null); setNote(null); }, [store, doc.project.id]);

  /** Una scheda che non c'è nasce col nome che le scene usano: è da lì che si ritrova. */
  const upsert = (patch: LocationPatch, field?: string) =>
    location && run({ type: "location.upsert", ref: location.ref, patch: sheet ? patch : { name: location.name, ...patch } }, field ? { gesture: `${location.ref}:${field}` } : {});

  async function propose(targets: readonly ProjectLocation[]) {
    if (targets.length === 0 || busy) return;
    setNote(null);
    setBusy(targets.length === 1 ? "propongo la descrizione…" : `propongo ${targets.length} descrizioni…`);
    try {
      const input = targets.map(toDescribe);
      const answers = await descriptionScope.schedule(describeService, "text", `${targets.length} descrizioni · ${describer}`, () => describe(input));
      if (!descriptionScope.isCurrent()) return;
      const filled: string[] = [];
      targets.forEach((target, i) => {
        const description = answers[i]?.description.trim();
        // Solo dove è ancora vuota: ciò che l'autore ha scritto nel frattempo resta suo.
        const now = latest.current.locations[target.ref];
        if (!description || now?.description.trim()) return;
        run({ type: "location.upsert", ref: target.ref, patch: now ? { description } : { name: target.name, description } }, { gesture: "describe-locations" });
        filled.push(target.name);
      });
      endGesture();
      setNote(
        filled.length > 0
          ? { level: "info", text: `Descrizioni proposte per ${filled.join(", ")}: rileggile, sono il punto di partenza. Ctrl+Z le toglie.` }
          : { level: "info", text: "Il modello non ha proposto niente: scrivi la descrizione a mano." },
      );
    } catch (cause) {
      if (!descriptionScope.isCurrent()) return;
      setNote({ level: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (descriptionScope.isCurrent()) setBusy(null);
    }
  }

  /** Una tavola del luogo vuoto, nello stile dell'opera: diventa il riferimento delle vignette ambientate lì. */
  async function plate() {
    if (!location || busy) return;
    setNote(null);
    setBusy("genero la tavola del luogo…");
    try {
      const current = sheet ?? LocationSheetSchema.parse({ schema: 1, id: location.ref, name: location.name });
      const spec = compileLocationSpec({ project: doc.project, location: current, model: specModel(image) });
      const path = locationSheetPath(spec);
      const { costUsd } = await generation.schedule(image.service, "image", `Luogo ${location.name} · ${image.service === "local" ? image.localModel ?? "locale" : specModel(image)}`, (signal) => generateReference({ store, service: makeService(image), spec, path, signal, cancelInFlight: image.service !== "local" }), () => latest.current.locations[location.ref] === (sheet ?? undefined));
      const now = latest.current.locations[location.ref];
      if (now?.description !== sheet?.description) throw new Error("La descrizione del luogo e' cambiata durante la generazione.");
      run({ type: "location.upsert", ref: location.ref, patch: { ...(now ? {} : { name: location.name }), references: [...(now?.references ?? current.references), { path, note: "tavola", use: true }] } });
      setNote({
        level: "info",
        text: `Tavola aggiunta${costUsd > 0 ? ` · addebitati ${usd(costUsd)}` : ""}. Se non è il posto giusto togli la spunta e generane un'altra; se lo è, ogni vignetta ambientata qui la riceverà.`,
      });
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setNote({ level: "error", text: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (generation.isCurrent()) setBusy(null);
    }
  }

  if (locations.length === 0) return <p className="field__hint">Nessun luogo: arrivano dallo spoglio del copione, dal nome che ogni scena dà al posto in cui si svolge.</p>;

  const describable = (sheet?.description.trim().length ?? 0) > 0;
  const ready = serviceReady(image);

  return (
    <div className="stack">
      {generation.phase === "queued" && <p className="field__hint" role="status">Tavola del luogo in coda</p>}
      {descriptionScope.phase === "queued" && <p className="field__hint" role="status">Descrizioni dei luoghi in coda</p>}
      <div className="character-list" onKeyDown={(e) => void listArrows(e)}>
        {locations.map((l) => {
          const level = completeness(l);
          return (
            <button
              key={l.ref}
              type="button"
              className="character-chip"
              data-item
              tabIndex={l.ref === location?.ref ? 0 : -1}
              aria-pressed={l.ref === location?.ref}
              onClick={() => setSelected(l.ref)}
              title={`${COMPLETENESS_LABEL[level]} · ${l.scenes.length === 1 ? "1 scena" : `${l.scenes.length} scene`}`}
            >
              <span className={`dot dot--sheet-${level}`} />
              {l.name}
            </button>
          );
        })}
      </div>
      {undescribed.length > 1 && (
        <div className="tool-row">
          <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => void propose(undescribed)} title="Dalle scene ambientate lì e dalle regole della serie">
            Proponi le descrizioni che mancano ({undescribed.length}) · {describer}
          </button>
        </div>
      )}

      {location && (
        <div className="card">
          <p className="card__title card__title--row">
            <span>
              luogo <code>{location.ref}</code>
            </span>
            {sheet && (
              <button type="button" className="link-btn" onClick={() => run({ type: "location.remove", ref: location.ref })} title="Toglie la scheda; le scene restano ambientate lì">
                togli la scheda
              </button>
            )}
          </p>
          <div className="stack">
            <p className="field__hint">
              {location.scenes.length === 0
                ? "Nessuna scena è ambientata qui."
                : `Ci sono ${location.scenes.length === 1 ? "1 scena" : `${location.scenes.length} scene`}: ${location.scenes
                    .slice(0, 4)
                    .map((s) => `«${s.title}» (${s.time_of_day})`)
                    .join(", ")}${location.scenes.length > 4 ? "…" : ""}.`}
            </p>
            <label className="field">
              <span className="field__label">com'è fatto</span>
              <textarea
                rows={4}
                value={sheet?.description ?? ""}
                placeholder="Studio piccolo con il soffitto basso. Scrivania di legno chiaro sotto una finestra con il vetro incrinato, a sinistra; sedia ergonomica rossa; libreria bianca sul fondo. Pavimento in graniglia grigia. Di giorno luce fredda dalla finestra, di sera solo il monitor."
                onChange={(e) => upsert({ description: e.target.value }, "description")}
                onBlur={endGesture}
              />
              <span className="field__hint">Pianta, arredi e dove stanno, materiali, colori, da dove viene la luce. L'ora no: è della scena. Va in ogni vignetta ambientata qui, parola per parola.</span>
            </label>
            <div className="grid-2">
              <label className="field">
                <span className="field__label">nome</span>
                <input type="text" value={sheet?.name ?? location.name} onChange={(e) => upsert({ name: e.target.value }, "name")} onBlur={endGesture} />
              </label>
              <label className="field">
                <span className="field__label">colori del luogo</span>
                <input type="text" value={sheet?.palette ?? ""} placeholder="grigio freddo, legno chiaro, rosso della sedia" onChange={(e) => upsert({ palette: e.target.value }, "palette")} onBlur={endGesture} />
              </label>
            </div>
            <div className="tool-row">
              <button type="button" className="btn btn--small" disabled={busy !== null} onClick={() => void propose([location])} title="Dalle scene ambientate qui e dalle regole della serie; solo se la descrizione è vuota">
                Proponi una descrizione · {describer}
              </button>
            </div>

            <span className="field__label">immagini del luogo</span>
            <ReferenceImages
              store={store}
              references={sheet?.references ?? []}
              onChange={(references) => upsert({ references })}
              directory={`locations/${location.ref}`}
              useHint="Se allegarla alle vignette ambientate qui: il modello ne prende pianta, arredi e materiali, non l'inquadratura"
            >
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy !== null || !describable || !ready}
                onClick={() => void plate()}
                title="Il luogo vuoto, visto largo, nello stile dell'opera; le immagini già spuntate qui lo tengono lo stesso posto"
              >
                Genera una tavola del luogo
              </button>
            </ReferenceImages>
            {busy && <p className="muted">{busy}</p>}
            {note && <p className={`issue issue--${note.level}`}>{note.text}</p>}
            {!describable && <p className="field__hint">Per generare la tavola serve la descrizione: è da lì che il modello disegna il posto.</p>}
            {describable && !ready && <p className="field__hint">Per generare serve il servizio di immagini configurato: Pagine → Arte → «servizio e spesa».</p>}
            <p className="field__hint">
              Una o due tavole bastano, anche da punti di vista diversi: la seconda guarda la prima, e resta lo stesso posto. Va bene anche una vignetta riuscita, tenuta come
              riferimento del luogo dalla scheda Arte.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
