import { useMemo, useRef, useState } from "react";
import {
  characterRefs,
  exportReadable,
  findMatches,
  parseAnnotated,
  revisionConflict,
  scriptImpact,
  type Command,
  type ExportFile,
  type FindOptions,
  type ProjectDoc,
  type RevisionEntry,
  type ScriptImpact,
} from "@comic-builder/core";

interface Props {
  doc: ProjectDoc;
  chapterId: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  onSelectPanel: (panelId: string) => void;
  write: (files: ExportFile[]) => Promise<string>;
}

const KIND_LABEL: Record<RevisionEntry["kind"], string> = {
  text: "testo",
  action: "azione",
  add: "battuta nuova",
  remove: "togli battuta",
  note: "nota",
};

const ORIGIN_LABEL: Record<RevisionEntry["origin"], string> = {
  annotated: "file corretto",
  script: "copione",
  "find-replace": "sostituzione",
  manual: "a mano",
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let batch = 0;

/**
 * Il giro con lo sceneggiatore (§10.1): si esporta il capitolo, torna
 * corretto — o torna un copione nuovo — e ogni differenza diventa una
 * correzione da accettare o rifiutare. Accettare riscrive solo i balloon
 * coinvolti, e la cache del lettering rimisura solo quelli.
 */
export function RevisionsPanel({ doc, chapterId, run, endGesture, onSelectPanel, write }: Props) {
  const [by, setBy] = useState("sceneggiatore");
  const [me] = useState("autore");
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [newScript, setNewScript] = useState("");
  const [impact, setImpact] = useState<ScriptImpact | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: true, scope: "balloons" });
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);

  const entries = doc.revisions[chapterId]?.entries ?? [];
  const open = entries.filter((e) => e.status === "open");
  const closed = entries.filter((e) => e.status !== "open");
  const conflicts = useMemo(() => new Map(open.map((e) => [e.id, revisionConflict(doc, e)])), [doc, open]);
  const applicable = open.filter((e) => conflicts.get(e.id) === null);
  const matches = useMemo(() => (find ? findMatches(doc, chapterId, find, replace, options) : []), [doc, chapterId, find, replace, options]);
  const refs = useMemo(() => [...characterRefs(doc)].sort(), [doc]);
  const now = () => new Date().toISOString();

  function done(text: string) {
    setMessage(text);
  }

  async function exportForReview() {
    const text = exportReadable(doc, chapterId);
    const where = await write([{ name: `${chapterId}-revisione.md`, data: text, mediaType: "text/markdown" }]);
    done(`File per lo sceneggiatore esportato (${where}). Te lo rimanda corretto: lo reimporti qui.`);
  }

  async function importAnnotated(file: File) {
    const result = parseAnnotated(doc, chapterId, await file.text());
    setWarnings(result.warnings);
    if (result.corrections.length === 0) {
      done("Nessuna differenza nel file: niente da correggere.");
      return;
    }
    if (run({ type: "revision.add", chapterId, entries: result.corrections, by, at: now() })) {
      done(`${result.corrections.length} correzioni importate da «${file.name}». Accettale o rifiutale qui sotto.`);
    }
  }

  function compareScript() {
    setImpact(scriptImpact(doc, chapterId, newScript));
  }

  async function adoptScript() {
    if (!impact) return;
    // Correzioni e copione nuovo sono un passo solo: un Ctrl+Z torna al prima.
    const gesture = `script-${++batch}`;
    if (impact.corrections.length > 0) run({ type: "revision.add", chapterId, entries: impact.corrections, by, at: now() }, { gesture });
    run({ type: "script.set", chapterId, text: newScript, sha: await sha256(newScript) }, { gesture });
    endGesture();
    done(`Copione aggiornato: ${impact.touched.length} pannelli toccati, ${impact.corrections.length} correzioni da decidere.`);
    setImpact(null);
    setNewScript("");
  }

  function accept(ids: string[]) {
    const touched = entries.filter((e) => ids.includes(e.id));
    if (run({ type: "revision.apply", chapterId, ids, by: me, at: now() })) {
      const balloons = touched.filter((e) => e.kind !== "note" && e.kind !== "action").length;
      done(`${ids.length} correzioni applicate: ${balloons} battute riletterate, il resto della pagina non si tocca.`);
    }
  }

  const cleanRename = renameTo.trim();

  return (
    <div className="stack revisions">
      <div className="card">
        <p className="card__title">scambio con lo sceneggiatore</p>
        <div className="tool-row">
          <button type="button" className="btn btn--small" onClick={() => void exportForReview()}>
            Esporta per la revisione (.md)
          </button>
          <button type="button" className="btn btn--small" onClick={() => fileInput.current?.click()}>
            Importa il file corretto…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importAnnotated(file);
            }}
          />
        </div>
        <label className="field field--inline">
          <span className="field__label">corretto da</span>
          <input type="text" value={by} onChange={(e) => setBy(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <p className="card__title">nuova versione del copione</p>
        <textarea rows={4} placeholder="Incolla qui il capitolo come lo rimanda lo sceneggiatore…" value={newScript} onChange={(e) => setNewScript(e.target.value)} />
        <div className="tool-row">
          <button type="button" className="btn btn--small" onClick={() => scriptInput.current?.click()}>
            Carica da file…
          </button>
          <input
            ref={scriptInput}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setNewScript(await file.text());
            }}
          />
          <button type="button" className="btn btn--small" disabled={!newScript.trim()} onClick={compareScript}>
            Confronta
          </button>
        </div>
        {!doc.scripts[chapterId] && (
          <p className="field__hint">Questo capitolo non ha ancora un copione di riferimento: il confronto vedrà tutto come nuovo.</p>
        )}
        {impact && (
          <div className="impact">
            {impact.hunks.length === 0 ? (
              <p className="field__hint">Nessuna differenza dal copione di riferimento.</p>
            ) : (
              <>
                <p>
                  {impact.hunks.length} parti cambiate · <strong>{impact.touched.length} pannelli toccati</strong> · {impact.corrections.length} correzioni
                  {impact.unassigned.length > 0 && ` · ${impact.unassigned.length} parti nuove fuori da ogni pannello, da impaginare`}
                </p>
                <div className="impact__panels">
                  {impact.touched.map((t) => (
                    <button key={t.panel.id} type="button" className="chip" onClick={() => onSelectPanel(t.panel.id)}>
                      {t.panel.id}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn btn--small btn--primary" onClick={() => void adoptScript()}>
                  Importa le correzioni e adotta questo copione
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {message && <p className="muted revisions__message">{message}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="issue issue--warning">
          {w}
        </p>
      ))}

      <div className="card">
        <p className="card__title card__title--row">
          <span>correzioni aperte ({open.length})</span>
          {open.length > 0 && (
            <span className="tool-row tool-row--tight">
              <button type="button" className="btn btn--small btn--primary" disabled={applicable.length === 0} onClick={() => accept(applicable.map((e) => e.id))}>
                Accetta le applicabili ({applicable.length})
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => run({ type: "revision.reject", chapterId, ids: open.map((e) => e.id), by: me, at: now() })}
              >
                Rifiuta tutte
              </button>
            </span>
          )}
        </p>
        {open.length === 0 && <p className="field__hint">Nessuna correzione in attesa.</p>}
        <ul className="revision-list">
          {open.map((entry) => {
            const conflict = conflicts.get(entry.id);
            return (
              <li key={entry.id} className={`revision${conflict ? " revision--conflict" : ""}`}>
                <div className="revision__head">
                  <span className="revision__kind">{KIND_LABEL[entry.kind]}</span>
                  <button type="button" className="link-btn" onClick={() => entry.panel && onSelectPanel(entry.panel)}>
                    {entry.balloon ?? entry.panel}
                  </button>
                  <span className="muted">
                    {ORIGIN_LABEL[entry.origin]} · {entry.by}
                  </span>
                </div>
                {entry.from !== null && entry.kind !== "add" && <p className="revision__from">{entry.from}</p>}
                {entry.to !== null && entry.kind !== "remove" && (
                  <p className="revision__to">
                    {entry.kind === "add" && entry.speaker ? `${entry.speaker.toUpperCase()}: ` : ""}
                    {entry.to}
                  </p>
                )}
                {entry.kind === "note" && entry.origin === "script" && (
                  <p className="field__hint">
                    Il copione cambia qui, ma non c'è una battuta da aggiornare con certezza (prosa, o una battuta già diversa nel fumetto): decidi tu cosa toccare.
                  </p>
                )}
                {conflict && <p className="issue issue--warning">Non applicabile: {conflict}</p>}
                <div className="tool-row tool-row--tight">
                  <button type="button" className="btn btn--small" disabled={conflict !== null} onClick={() => accept([entry.id])}>
                    {entry.kind === "note" ? "Presa visione" : "Accetta"}
                  </button>
                  <button type="button" className="btn btn--small" onClick={() => run({ type: "revision.reject", chapterId, ids: [entry.id], by: me, at: now() })}>
                    Rifiuta
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {closed.length > 0 && (
          <button type="button" className="link-btn" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "nascondi lo storico" : `storico: ${closed.filter((e) => e.status === "applied").length} applicate, ${closed.filter((e) => e.status === "rejected").length} rifiutate`}
          </button>
        )}
        {showHistory && (
          <ul className="revision-list revision-list--history">
            {closed.map((e) => (
              <li key={e.id}>
                <code>{e.id}</code> {e.status === "applied" ? "✓" : "✗"} {KIND_LABEL[e.kind]} {e.balloon ?? e.panel}
                {e.rev !== null && <span className="muted"> · rev {e.rev}</span>}
                <span className="muted"> · {e.resolved_by}, {e.resolved_at ? new Date(e.resolved_at).toLocaleString() : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p className="card__title">trova e sostituisci</p>
        <div className="grid-2">
          <label className="field">
            <span className="field__label">trova</span>
            <input type="text" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">sostituisci con</span>
            <input type="text" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </label>
        </div>
        <div className="tool-row">
          <label className="field field--row">
            <input type="checkbox" checked={options.wholeWord ?? false} onChange={(e) => setOptions({ ...options, wholeWord: e.target.checked })} />
            <span>parola intera</span>
          </label>
          <label className="field field--row">
            <input type="checkbox" checked={options.matchCase ?? false} onChange={(e) => setOptions({ ...options, matchCase: e.target.checked })} />
            <span>maiuscole</span>
          </label>
          <label className="field field--row">
            <input type="checkbox" checked={options.scope === "both"} onChange={(e) => setOptions({ ...options, scope: e.target.checked ? "both" : "balloons" })} />
            <span>anche nelle azioni</span>
          </label>
        </div>
        {find && <p className="field__hint">{matches.length === 0 ? "Nessuna occorrenza." : `${matches.reduce((n, m) => n + m.count, 0)} occorrenze in ${matches.length} testi.`}</p>}
        <button
          type="button"
          className="btn btn--small"
          disabled={matches.length === 0}
          onClick={() => {
            if (run({ type: "text.replace", chapterId, find, replace, options, by: me, at: now() })) done(`«${find}» → «${replace}» in ${matches.length} testi, ognuno tracciato nel changelog.`);
          }}
        >
          Sostituisci tutto
        </button>
      </div>

      <div className="card">
        <p className="card__title">rinomina un personaggio</p>
        <div className="grid-2">
          <label className="field">
            <span className="field__label">personaggio</span>
            <select value={renameFrom} onChange={(e) => setRenameFrom(e.target.value)}>
              <option value="">—</option>
              {refs.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">nuovo nome</span>
            <input type="text" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
          </label>
        </div>
        <p className="field__hint">Cambia chi parla e chi è in vignetta in tutto il progetto. Il nome dentro le battute si cambia con trova e sostituisci.</p>
        <button
          type="button"
          className="btn btn--small"
          disabled={!renameFrom || !cleanRename}
          onClick={() => {
            if (run({ type: "character.rename", from: renameFrom, to: cleanRename })) {
              done(`${renameFrom} ora si chiama ${cleanRename}.`);
              setFind(renameFrom);
              setReplace(cleanRename);
              setRenameFrom("");
              setRenameTo("");
            }
          }}
        >
          Rinomina
        </button>
      </div>
    </div>
  );
}
