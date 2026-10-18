import { formatUsd as usd, t } from "../i18n.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  appearanceText,
  characterRefs,
  characterSheetPath,
  compileCharacterSheetSpec,
  compileLocationSpec,
  locationSheetPath,
  projectLocations,
  SHEET_VIEWS,
  type CharacterSheet,
  type Command,
  type ProjectDoc,
  type ProjectLocation,
  type ProjectStore,
  type RenderSpec,
} from "@comic-builder/core";
import { estimateQueue } from "@comic-builder/image";
import { jobModel, makeService, onThisMachine, serviceReady, specMaxReferences, specModel, type ImageConfig } from "./GenerateCard.js";
import { generateReference } from "../editor/generateArt.js";
import { usePreference } from "../usePreference.js";
import { useGeneration } from "../useGeneration.js";

interface Props {
  doc: ProjectDoc;
  store: ProjectStore;
  image: ImageConfig;
  run: (command: Command, options?: { gesture?: string }) => boolean;
}

const used = (references: ReadonlyArray<{ use: boolean }> | undefined) => (references ?? []).some((r) => r.use);

/** Chi va disegnato prima delle vignette: descritto, ma ancora senza un'immagine da guardare. */
function missing(doc: ProjectDoc): { characters: CharacterSheet[]; places: ProjectLocation[] } {
  const characters = [...characterRefs(doc)]
    .sort()
    .map((ref) => doc.characters[ref])
    .filter((sheet): sheet is CharacterSheet => sheet !== undefined && appearanceText(sheet).length > 0 && !used(sheet.references));
  const places = projectLocations(doc).filter((place) => (place.sheet?.description.trim().length ?? 0) > 0 && !used(place.sheet?.references));
  return { characters, places };
}

/**
 * Il passo fra lo spoglio e le vignette, in un gesto solo: la vista di
 * fronte di ogni personaggio descritto e la tavola di ogni luogo descritto
 * che non hanno ancora un'immagine. Sono i riferimenti che le vignette si
 * portano dietro: generarle prima evita un capitolo in cui ogni pagina
 * reinventa facce e stanze, da rigenerare poi tutto.
 *
 * Un lavoro solo in coda, un'immagine dopo l'altra; ognuna entra nella sua
 * scheda appena arriva, e chi nel frattempo ha avuto un'immagine, o una
 * descrizione diversa, si salta.
 */
export function ReferencesPrep({ doc, store, image, run }: Props) {
  const generation = useGeneration(store, doc.project.id);
  const latest = useRef(doc);
  latest.current = doc;
  const [cap] = usePreference("imageCapUsd", 2);
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<{ level: "info" | "warning" | "error"; text: string } | null>(null);
  useEffect(() => { setProgress(null); setNote(null); }, [store, doc.project.id]);

  const todo = useMemo(() => missing(doc), [doc]);
  const ready = serviceReady(image);
  const model = specModel(image);
  const maxReferences = specMaxReferences(image);
  const characterSpec = (sheet: CharacterSheet) => compileCharacterSheetSpec({ project: latest.current.project, sheet, view: "front", model, maxReferences });
  const placeSpec = (place: ProjectLocation) => compileLocationSpec({ project: latest.current.project, location: place.sheet!, model, maxReferences });
  const total = todo.characters.length + todo.places.length;
  const estimate = useMemo(() => {
    if (!ready || total === 0) return null;
    try {
      const specs: RenderSpec[] = [...todo.characters.map(characterSpec), ...todo.places.map(placeSpec)];
      return estimateQueue(makeService(image), specs, onThisMachine(image) ? 1 : 2);
    } catch {
      return null;
    }
  }, [todo, ready, model, maxReferences, image.service]);

  const anything = Object.keys(doc.characters).length > 0 || projectLocations(doc).length > 0;
  if (!anything) return null;

  async function prepare() {
    setNote(null);
    if (estimate && estimate.usd > cap) {
      setNote({ level: "error", text: t("La stima ({0}) supera il tetto di spesa ({1}): alzalo in Pagine → Arte → «servizio e spesa».", usd(estimate.usd), usd(cap)) });
      return;
    }
    const characters = todo.characters;
    const places = todo.places;
    let made = 0;
    let cost = 0;
    const failed: string[] = [];
    const skipped: string[] = [];
    try {
      await generation.schedule(image.service, "image", t("Riferimenti mancanti · {0} · {1}", characters.length + places.length, jobModel(image)), async (signal, isCurrent) => {
        const service = makeService(image);
        const cancelInFlight = image.service !== "local";
        let step = 0;
        const count = characters.length + places.length;
        for (const before of characters) {
          if (!isCurrent()) throw new DOMException(t("Generazione annullata."), "AbortError");
          step++;
          const now = latest.current.characters[before.id];
          // Nel frattempo l'autore gli ha dato un'immagine, o l'ha descritto in un altro modo: si lascia com'è.
          if (!now || used(now.references) || appearanceText(now) !== appearanceText(before)) {
            skipped.push(before.name || before.id);
            continue;
          }
          const name = now.name || now.id;
          setProgress(t("{0}/{1} · {2}", step, count, name));
          try {
            const spec = characterSpec(now);
            const path = characterSheetPath(spec, "front");
            cost += (await generateReference({ store, service, spec, path, signal, cancelInFlight })).costUsd;
            if (!isCurrent()) throw new DOMException(t("Generazione annullata."), "AbortError");
            const updated = latest.current.characters[before.id];
            if (!updated) continue;
            run({ type: "character.upsert", ref: before.id, patch: { references: [...updated.references, { path, note: SHEET_VIEWS.front.label, use: true }] } });
            made++;
          } catch (cause) {
            if (!isCurrent() || signal.aborted) throw cause;
            failed.push(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
        for (const before of places) {
          if (!isCurrent()) throw new DOMException(t("Generazione annullata."), "AbortError");
          step++;
          const sheet = latest.current.locations[before.ref];
          if (!sheet || used(sheet.references) || sheet.description !== before.sheet?.description) {
            skipped.push(before.name);
            continue;
          }
          setProgress(t("{0}/{1} · {2}", step, count, before.name));
          try {
            const spec = placeSpec({ ...before, sheet });
            const path = locationSheetPath(spec);
            cost += (await generateReference({ store, service, spec, path, signal, cancelInFlight })).costUsd;
            if (!isCurrent()) throw new DOMException(t("Generazione annullata."), "AbortError");
            const updated = latest.current.locations[before.ref];
            if (!updated) continue;
            run({ type: "location.upsert", ref: before.ref, patch: { references: [...updated.references, { path, note: "tavola", use: true }] } });
            made++;
          } catch (cause) {
            if (!isCurrent() || signal.aborted) throw cause;
            failed.push(`${before.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
      }, undefined, estimate ? { usd: estimate.usd, capUsd: cap } : undefined);
      setNote({
        level: failed.length > 0 ? "warning" : "info",
        text: [
          t("{0} riferimenti generati{1}. Rivedili nelle schede: togli la spunta a quelli che non vanno, e rigenerali da lì.", made, cost > 0 ? t(" · addebitati {0}", usd(cost)) : ""),
          skipped.length > 0 ? t("Saltati perché cambiati nel frattempo: {0}.", skipped.join(", ")) : null,
          failed.length > 0 ? t("Non riusciti: {0}", failed.join(" · ")) : null,
        ].filter(Boolean).join(" "),
      });
    } catch (cause) {
      if (!generation.isCurrent()) return;
      setNote({ level: "error", text: `${made > 0 ? t("{0} fatte, poi: ", made) : ""}${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setProgress(null);
    }
  }

  const names = [...todo.characters.map((c) => c.name || c.id), ...todo.places.map((p) => p.name)];

  return (
    <div className="card references-prep">
      <p className="card__title card__title--row">
        <span>{t("prepara i riferimenti")}</span>
        <span className="muted">{jobModel(image)}</span>
      </p>
      {total === 0 ? (
        <p className="field__hint">{t("Ogni personaggio e luogo descritto ha almeno un'immagine: le vignette hanno qualcosa da guardare.")}</p>
      ) : (
        <div className="stack">
          <p className="field__hint">
            {t("Prima delle vignette: una vista di fronte per {0} e una tavola per {1}, nello stile dell'opera. Ogni vignetta poi le riceve, e facce e stanze restano le stesse da una pagina all'altra.", t("{0} personaggi", todo.characters.length), t("{0} luoghi", todo.places.length))}
          </p>
          <p className="field__hint">{names.join(", ")}</p>
          <div className="tool-row">
            <button type="button" className="btn btn--small btn--primary" disabled={!ready} onClick={() => void prepare()}>
              {t("Genera {0} riferimenti", total)}
              {estimate ? ` · ~${usd(estimate.usd)}, ~${estimate.seconds} s` : ""}
            </button>
            {generation.running > 0 && (
              <button type="button" className="link-btn" onClick={generation.cancel}>
                {t("ferma")}
              </button>
            )}
            {progress && <span role="status">{progress}</span>}
            {!progress && generation.queued > 0 && <span role="status">{t("in coda")}</span>}
          </div>
          {!ready && <p className="field__hint">{t("Per generare serve il servizio di immagini configurato: Pagine → Arte → «servizio e spesa».")}</p>}
        </div>
      )}
      {note && <p className={`issue issue--${note.level}`}>{note.text}</p>}
    </div>
  );
}
