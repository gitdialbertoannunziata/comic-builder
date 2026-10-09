import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  canForceRevision,
  chapterSceneIds,
  characterRefs,
  diffWords,
  exportReadable,
  findMatches,
  lintRevisions,
  parseAnnotated,
  partitionIncoming,
  revisionConflict,
  revisionScope,
  revisionState,
  scriptImpact,
  suggestLesson,
  type Command,
  type ExportFile,
  type FindOptions,
  type NewRevision,
  type ProjectDoc,
  type RevisionEntry,
  type RevisionState,
} from "@comic-builder/core";
import { isTyping, listArrows, useLegend } from "../keyboard.js";

interface Props {
  doc: ProjectDoc;
  chapterId: string;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  onSelectPanel: (panelId: string) => void;
  write: (files: ExportFile[]) => Promise<string>;
  /** Mostra solo le voci di questa vignetta o di questa pagina: ci si arriva dall'editor. */
  filter?: string | null;
  onClearFilter?: () => void;
}

const KIND_LABEL: Record<RevisionEntry["kind"], string> = {
  text: "testo",
  action: "azione",
  add: "battuta nuova",
  remove: "togli battuta",
  note: "nota",
  set: "campo",
};

const FIELD_LABEL: Record<NonNullable<RevisionEntry["field"]>, string> = {
  setting: "luogo",
  continuity_notes: "continuità",
  speaker: "chi parla",
  balloon_type: "tipo di battuta",
};

const STATE_LABEL: Record<RevisionState, string> = {
  current: "in vigore",
  superseded: "poi modificata",
  lost: "non più nel documento",
};

const kindLabel = (e: RevisionEntry) => (e.kind === "set" && e.field ? FIELD_LABEL[e.field] : KIND_LABEL[e.kind]);

/** Il prima e il dopo: parola per parola dove è testo, uno accanto all'altro dove è un valore. */
function Change({ entry }: { entry: RevisionEntry }) {
  const speaker = entry.kind === "add" && entry.speaker ? `${entry.speaker.toUpperCase()}: ` : "";
  if (entry.kind === "remove") return <p className="revision__from">{entry.from}</p>;
  if (entry.kind === "add" || entry.kind === "note" || entry.from === null) {
    return entry.to === null ? null : (
      <p className={entry.kind === "note" ? "revision__note" : "revision__to"}>
        {speaker}
        {entry.to}
      </p>
    );
  }
  if (entry.kind === "set" && (entry.field === "speaker" || entry.field === "balloon_type")) {
    return (
      <p className="revision__diff">
        <del>{entry.from || "nessuno"}</del> → <ins>{entry.to || "nessuno"}</ins>
      </p>
    );
  }
  return (
    <p className="revision__diff">
      {diffWords(entry.from, entry.to ?? "").map((seg, i) => (seg.kind === "same" ? <span key={i}>{seg.text}</span> : seg.kind === "del" ? <del key={i}>{seg.text}</del> : <ins key={i}>{seg.text}</ins>))}
    </p>
  );
}

type Asking = { id: string; what: "edit" | "done" | "reject" | "lesson"; text: string };

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
export function RevisionsPanel({ doc, chapterId, run, endGesture, onSelectPanel, write, filter = null, onClearFilter }: Props) {
  const [by, setBy] = useState("sceneggiatore");
  const [me] = useState("autore");
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [newScript, setNewScript] = useState("");
  const [compared, setCompared] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteTarget, setNoteTarget] = useState("chapter");
  const [showHistory, setShowHistory] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: true, scope: "balloons" });
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);

  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  const chapterPages = useMemo(() => (chapter?.pages ?? []).flatMap((id) => (doc.pages[id] ? [doc.pages[id]] : [])), [chapter, doc.pages]);
  const scenes = useMemo(() => {
    const ids = chapterSceneIds(doc, chapterId);
    return doc.scenes.scenes.filter((s) => ids.has(s.id));
  }, [doc, chapterId]);
  // Il confronto segue il documento: se cambia sotto, i pannelli toccati si ricalcolano.
  const impact = useMemo(() => (compared === null ? null : scriptImpact(doc, chapterId, compared)), [doc, chapterId, compared]);

  const all = doc.revisions[chapterId]?.entries ?? [];
  const entries = useMemo(() => {
    if (!filter) return all;
    const onPage = new Set(doc.pages[filter]?.panels.map((p) => p.id) ?? []);
    return all.filter((e) => e.panel === filter || e.page === filter || (e.panel !== null && onPage.has(e.panel)));
  }, [all, filter, doc.pages]);
  const open = entries.filter((e) => e.status === "open");
  const closed = entries.filter((e) => e.status !== "open");
  const conflicts = useMemo(() => new Map(open.map((e) => [e.id, revisionConflict(doc, e, chapterId)])), [doc, open, chapterId]);
  const changelogIssues = useMemo(() => lintRevisions(doc).filter((i) => i.path.startsWith(`revisions[${chapterId}]`)), [doc, chapterId]);
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
    const parts = partitionIncoming(doc, chapterId, result.corrections);
    const skipped = [
      parts.alreadyOpen.length > 0 ? `${parts.alreadyOpen.length} già in attesa` : "",
      parts.alreadyRejected.length > 0 ? `${parts.alreadyRejected.length} già rifiutate, non riproposte (si riaprono dallo storico)` : "",
    ].filter(Boolean);
    const tail = skipped.length > 0 ? ` ${skipped.join("; ")}.` : "";
    if (parts.fresh.length === 0) {
      done(`Niente di nuovo in «${file.name}».${tail}`);
      return;
    }
    if (run({ type: "revision.add", chapterId, entries: result.corrections, by, at: now() })) {
      done(`${parts.fresh.length} correzioni importate da «${file.name}». Accettale o rifiutale qui sotto.${tail}`);
    }
  }

  function compareScript() {
    setCompared(newScript);
  }

  function addNote() {
    const text = noteText.trim();
    if (!text) return;
    const [scope, id] = noteTarget.split(":");
    const note: NewRevision = { origin: "manual", kind: "note", panel: null, balloon: null, speaker: null, from: null, to: text, source_line: null, page: scope === "page" ? id! : null, scene: scope === "scene" ? id! : null };
    if (run({ type: "revision.add", chapterId, entries: [note], by: me, at: now(), again: true })) setNoteText("");
  }

  /** A cosa si riferisce una voce, come lo legge chi lavora: la battuta, la vignetta, «pagina 3». */
  function targetOf(entry: RevisionEntry): { label: string; panel: string | null } {
    switch (revisionScope(entry)) {
      case "balloon":
        return { label: entry.balloon!, panel: entry.panel };
      case "panel":
        return { label: entry.panel!, panel: entry.panel };
      case "page": {
        const page = doc.pages[entry.page!];
        return { label: page ? `pagina ${page.order}` : `pagina ${entry.page} (non c'è più)`, panel: page?.panels[0]?.id ?? null };
      }
      case "scene": {
        const scene = doc.scenes.scenes.find((s) => s.id === entry.scene);
        const first = chapterPages.flatMap((p) => p.panels).find((p) => p.scene_id === entry.scene);
        return { label: scene ? `scena «${scene.title}»` : `scena ${entry.scene} (non c'è più)`, panel: first?.id ?? null };
      }
      case "chapter":
        return { label: "tutto il capitolo", panel: null };
    }
  }

  function confirmAsking() {
    if (!asking) return;
    const text = asking.text.trim();
    const { id } = asking;
    const ok =
      asking.what === "edit"
        ? text.length > 0 && run({ type: "revision.edit", chapterId, id, to: text })
        : asking.what === "done"
          ? run({ type: "revision.apply", chapterId, ids: [id], by: me, at: now(), ...(text ? { resolution: text } : {}) })
          : asking.what === "reject"
            ? run({ type: "revision.reject", chapterId, ids: [id], by: me, at: now(), ...(text ? { resolution: text } : {}) })
            : run({ type: "revision.lesson", chapterId, id, lesson: text || null });
    if (ok) {
      if (asking.what === "lesson" && text) done("Regola aggiunta alla serie: arriva allo spoglio di ogni capitolo (la vedi in Copione, «cosa riceve il modello»).");
      setAsking(null);
    }
  }

  const ASK: Record<Asking["what"], { label: string; confirm: string }> = {
    edit: { label: "testo proposto", confirm: "Salva" },
    done: { label: "cosa hai fatto (facoltativo)", confirm: "Fatta" },
    reject: { label: "perché (facoltativo)", confirm: "Rifiuta" },
    lesson: { label: "regola per la serie: vale per ogni capitolo", confirm: "Salva la regola" },
  };

  function askBox(entry: RevisionEntry) {
    if (asking?.id !== entry.id) return null;
    return (
      <div className="revision__ask">
        <label className="field">
          <span className="field__label">{ASK[asking.what].label}</span>
          <textarea rows={2} autoFocus value={asking.text} onChange={(e) => setAsking({ ...asking, text: e.target.value })} />
        </label>
        <div className="tool-row tool-row--tight">
          <button type="button" className="btn btn--small btn--primary" disabled={asking.what === "edit" && !asking.text.trim()} onClick={confirmAsking}>
            {ASK[asking.what].confirm}
          </button>
          <button type="button" className="link-btn" onClick={() => setAsking(null)}>
            annulla
          </button>
        </div>
      </div>
    );
  }

  function lessonRow(entry: RevisionEntry) {
    return (
      <p className="revision__lesson">
        {entry.lesson && <span>regola per la serie: «{entry.lesson}» </span>}
        <button type="button" className="link-btn" onClick={() => setAsking({ id: entry.id, what: "lesson", text: entry.lesson ?? suggestLesson(entry) })}>
          {entry.lesson ? "cambia" : "vale per la serie…"}
        </button>
        {entry.lesson && (
          <>
            {" "}
            <button type="button" className="link-btn" onClick={() => run({ type: "revision.lesson", chapterId, id: entry.id, lesson: null })}>
              togli
            </button>
          </>
        )}
      </p>
    );
  }

  async function adoptScript() {
    if (!impact || compared === null) return;
    // Correzioni e copione nuovo sono un passo solo: un Ctrl+Z torna al prima.
    const gesture = `script-${++batch}`;
    if (impact.corrections.length > 0) run({ type: "revision.add", chapterId, entries: impact.corrections, by, at: now() }, { gesture });
    run({ type: "script.set", chapterId, text: compared, sha: await sha256(compared) }, { gesture });
    endGesture();
    done(`Copione aggiornato: ${impact.touched.length} pannelli toccati, ${impact.corrections.length} correzioni da decidere.`);
    setCompared(null);
    setNewScript("");
  }

  function accept(ids: string[], force = false) {
    const touched = entries.filter((e) => ids.includes(e.id));
    if (run({ type: "revision.apply", chapterId, ids, by: me, at: now(), ...(force ? { force } : {}) })) {
      const balloons = touched.filter((e) => e.kind === "text" || e.kind === "add" || e.kind === "remove").length;
      done(`${ids.length} correzioni applicate: ${balloons} battute riletterate, il resto della pagina non si tocca.`);
    }
  }

  useLegend("Revisioni, su una voce aperta", 40, [
    { keys: ["ArrowUp", "ArrowDown"], shown: "↑ ↓", label: "Voce precedente / successiva" },
    { keys: ["a"], label: "Accetta (per una nota: fatta…)" },
    { keys: ["r"], label: "Rifiuta" },
    { keys: ["Enter"], label: "Va alla vignetta" },
  ]);

  /**
   * Sulla voce che ha il focus: A accetta, R rifiuta, Invio porta alla vignetta, le frecce passano
   * alla vicina. Chiusa una voce il focus va a quella che ne prende il posto: dodici correzioni
   * sono dodici tasti, senza riprendere il mouse.
   */
  function onOpenKeys(event: KeyboardEvent<HTMLUListElement>) {
    if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return;
    const item = event.target.closest<HTMLElement>("[data-item]");
    const entry = open.find((e) => e.id === item?.dataset.id);
    if (!item || !entry) return;
    const list = event.currentTarget;
    const at = open.indexOf(entry);
    const focusNext = () =>
      requestAnimationFrame(() => {
        const items = list.querySelectorAll<HTMLElement>("[data-item]");
        items[Math.min(at, items.length - 1)]?.focus();
      });
    const key = event.key.toLowerCase();
    if (key === "a" || key === "r") {
      event.preventDefault();
      if (event.repeat) return;
      if (key === "r") {
        if (run({ type: "revision.reject", chapterId, ids: [entry.id], by: me, at: now() })) focusNext();
      } else if (entry.kind === "note") {
        setAsking({ id: entry.id, what: "done", text: "" });
      } else if ((conflicts.get(entry.id) ?? null) === null) {
        accept([entry.id]);
        focusNext();
      }
    } else if (event.key === "Enter" && event.target === item) {
      const panel = targetOf(entry).panel;
      if (!panel) return;
      event.preventDefault();
      onSelectPanel(panel);
    } else {
      listArrows(event);
    }
  }

  const cleanRename = renameTo.trim();

  return (
    <div className="revisions">
      <div className="stack revisions__in">
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
          {!doc.scripts[chapterId] && <p className="field__hint">Questo capitolo non ha ancora un copione di riferimento: il confronto vedrà tutto come nuovo.</p>}
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

        <div className="card">
          <p className="card__title">nuova nota</p>
          <label className="field field--inline">
            <span className="field__label">su</span>
            <select value={noteTarget} onChange={(e) => setNoteTarget(e.target.value)}>
              <option value="chapter">tutto il capitolo</option>
              {scenes.map((s) => (
                <option key={s.id} value={`scene:${s.id}`}>
                  scena «{s.title}»
                </option>
              ))}
              {chapterPages.map((p) => (
                <option key={p.id} value={`page:${p.id}`}>
                  pagina {p.order}
                </option>
              ))}
            </select>
          </label>
          <textarea rows={2} placeholder="Cosa c'è da rivedere: ritmo, layout, inquadrature, disegno…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <div className="tool-row">
            <button type="button" className="btn btn--small" disabled={!noteText.trim()} onClick={addNote}>
              Aggiungi la nota
            </button>
          </div>
          <p className="field__hint">Una vignetta o una battuta si annotano dall'editor, con «annota…».</p>
        </div>

        {message && <p className="muted revisions__message">{message}</p>}
        {warnings.map((w, i) => (
          <p key={i} className="issue issue--warning">
            {w}
          </p>
        ))}
      </div>

      <div className="card revisions__list">
        {filter && (
          <p className="revisions__filter">
            Solo le voci di <strong>{doc.pages[filter] ? `pagina ${doc.pages[filter].order}` : filter}</strong>.{" "}
            <button type="button" className="link-btn" onClick={onClearFilter}>
              mostra tutto il capitolo
            </button>
          </p>
        )}
        {changelogIssues.map((i) => (
          <p key={i.path + i.code} className="issue issue--warning">
            {i.message}
          </p>
        ))}
        <p className="card__title card__title--row">
          <span>revisioni aperte ({open.length})</span>
          {open.length > 0 && (
            <span className="tool-row tool-row--tight">
              <button type="button" className="btn btn--small btn--primary" disabled={applicable.length === 0} onClick={() => accept(applicable.map((e) => e.id))}>
                Accetta le applicabili ({applicable.length})
              </button>
              <button type="button" className="btn btn--small" onClick={() => run({ type: "revision.reject", chapterId, ids: open.filter((e) => e.kind !== "note").map((e) => e.id), by: me, at: now() })}>
                Rifiuta tutte
              </button>
            </span>
          )}
        </p>
        {open.length === 0 && <p className="field__hint">Nessuna revisione in attesa.</p>}
        <ul className="revision-list" onKeyDown={onOpenKeys}>
          {open.map((entry, position) => {
            const conflict = conflicts.get(entry.id) ?? null;
            const target = targetOf(entry);
            const note = entry.kind === "note";
            return (
              <li key={entry.id} className={`revision${conflict ? " revision--conflict" : ""}`} data-item data-id={entry.id} tabIndex={position === 0 ? 0 : -1}>
                <div className="revision__head">
                  <span className="revision__kind">{kindLabel(entry)}</span>
                  {target.panel ? (
                    <button type="button" className="link-btn" onClick={() => onSelectPanel(target.panel!)}>
                      {target.label}
                    </button>
                  ) : (
                    <span>{target.label}</span>
                  )}
                  <span className="muted">
                    {ORIGIN_LABEL[entry.origin]} · {entry.by}
                  </span>
                </div>
                <Change entry={entry} />
                {note && entry.origin === "script" && (
                  <p className="field__hint">Il copione cambia qui, ma non c'è una battuta da aggiornare con certezza (prosa, o una battuta già diversa nel fumetto): decidi tu cosa toccare.</p>
                )}
                {conflict && <p className="issue issue--warning">Non applicabile: {conflict}</p>}
                {askBox(entry) ?? (
                  <div className="tool-row tool-row--tight">
                    {note ? (
                      <button type="button" className="btn btn--small" onClick={() => setAsking({ id: entry.id, what: "done", text: "" })}>
                        Fatta…
                      </button>
                    ) : (
                      <button type="button" className="btn btn--small" disabled={conflict !== null} onClick={() => accept([entry.id])}>
                        Accetta
                      </button>
                    )}
                    {conflict && canForceRevision(doc, entry, chapterId) && (
                      <button type="button" className="btn btn--small" onClick={() => accept([entry.id], true)} title="Sovrascrive ciò che c'è ora; il changelog registra cosa c'era">
                        Applica comunque
                      </button>
                    )}
                    <button type="button" className="btn btn--small" onClick={() => run({ type: "revision.reject", chapterId, ids: [entry.id], by: me, at: now() })}>
                      {note ? "Scarta" : "Rifiuta"}
                    </button>
                    {entry.kind !== "remove" && entry.field !== "speaker" && entry.field !== "balloon_type" && (
                      <button type="button" className="link-btn" onClick={() => setAsking({ id: entry.id, what: "edit", text: entry.to ?? "" })}>
                        modifica
                      </button>
                    )}
                    <button type="button" className="link-btn" onClick={() => setAsking({ id: entry.id, what: "reject", text: "" })}>
                      {note ? "scarta" : "rifiuta"} con motivo
                    </button>
                  </div>
                )}
                {asking?.id !== entry.id && lessonRow(entry)}
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
            {closed.map((e) => {
              const state = revisionState(doc, e, chapterId);
              const reopenable = e.status === "rejected" || e.kind === "note";
              return (
                <li key={e.id} className="revision-past">
                  <code>{e.id}</code> {e.status === "applied" ? "✓" : "✗"} {kindLabel(e)} {targetOf(e).label}
                  {state && <span className={`revision-past__state revision-past__state--${state}`}> · {STATE_LABEL[state]}</span>}
                  <span className="muted">
                    {" "}
                    · {e.resolved_by}, {e.resolved_at ? new Date(e.resolved_at).toLocaleString() : ""}
                  </span>
                  <Change entry={e} />
                  {e.replaced !== null && <p className="field__hint">Applicata sopra un testo diverso da quello atteso: «{e.replaced}».</p>}
                  {e.resolution && <p className="field__hint">{e.status === "rejected" ? "Motivo" : "Fatto"}: {e.resolution}</p>}
                  {askBox(e) ?? (
                    <div className="tool-row tool-row--tight">
                      {reopenable && (
                        <button type="button" className="link-btn" onClick={() => run({ type: "revision.reopen", chapterId, ids: [e.id] })}>
                          riapri
                        </button>
                      )}
                      {state === "current" && e.kind !== "remove" && (
                        <button type="button" className="link-btn" onClick={() => run({ type: "revision.revert", chapterId, id: e.id, by: me, at: now() })} title="Torna al testo di prima, con una correzione inversa nel changelog">
                          ripristina
                        </button>
                      )}
                    </div>
                  )}
                  {asking?.id !== e.id && lessonRow(e)}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="stack revisions__tools">
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
    </div>
  );
}
