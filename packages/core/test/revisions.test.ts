import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { changedFiles, loadProject, projectDocFrom, revisionsPath, saveProject, type ProjectDoc } from "../src/document/projectDoc.js";
import { MemoryProjectStore } from "../src/document/store.js";
import { applyCommand, CommandError } from "../src/editor/commands.js";
import { canForceRevision, partitionIncoming, retext, revisionConflict, revisionScope, revisionState, locate, type NewRevision } from "../src/revisions/revisionCommands.js";
import { seriesLessons, suggestLesson } from "../src/revisions/lessons.js";
import { diffWords } from "../src/revisions/wordDiff.js";
import { RevisionsDocSchema } from "../src/schema/revisions.js";
import { lintRevisions } from "../src/revisions/lintRevisions.js";

const pages = buildPagesFromScene({ scene: sampleScene, chapterId: "ep001", firstPageNumber: 1, primaryTarget: "digital-page", gutter: { x: 14, y: 18 }, readingDirection: "ltr" });
const doc: ProjectDoc = projectDocFrom({ project: sampleProject, scenes: [sampleScene], chapter: { id: "ep001", number: 1, title: "t" }, pages, script: "# copione\n" });
const AT = "2026-09-22T10:00:00Z";
const talking = pages.flatMap((p) => p.panels).find((p) => p.balloons.length > 0)!;
const balloon = talking.balloons[0]!;
const text = balloon.text.map((r) => r.t).join("");

function correction(to: string, from = text): NewRevision {
  return { origin: "annotated", kind: "text", panel: talking.id, balloon: balloon.id, speaker: null, from, to, source_line: null };
}
const add = (d: ProjectDoc, entries: NewRevision[]) => applyCommand(d, { type: "revision.add", chapterId: "ep001", entries, by: "sceneggiatore", at: AT });
const entries = (d: ProjectDoc) => d.revisions.ep001!.entries;

describe("Changelog delle revisioni (§10.2)", () => {
  it("le correzioni importate hanno id progressivi, stato open, chi e quando", () => {
    const d = add(doc, [correction("Uno."), correction("Due.")]);
    expect(entries(d).map((e) => [e.id, e.status, e.by, e.at])).toEqual([
      ["r-0001", "open", "sceneggiatore", AT],
      ["r-0002", "open", "sceneggiatore", AT],
    ]);
  });

  it("la stessa correzione importata due volte non si duplica", () => {
    const d = add(add(doc, [correction("Uno.")]), [correction("Uno.")]);
    expect(entries(d)).toHaveLength(1);
  });

  it("applicare cambia il testo, alza rev, e segna la voce con la rev risultante", () => {
    const d = add(doc, [correction("Da quanto è spenta?")]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "autore", at: AT });
    const b = locate(applied, { panel: null, balloon: balloon.id })!.balloon!;
    expect(b.text).toEqual([{ t: "Da quanto è spenta?" }]);
    expect(b.rev).toBe(balloon.rev + 1);
    expect(entries(applied)[0]).toMatchObject({ status: "applied", rev: b.rev, resolved_by: "autore", resolved_at: AT });
  });

  it("applicare tocca solo i balloon coinvolti: il resto è condiviso per riferimento", () => {
    const d = add(doc, [correction("Nuovo.")]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    const writes = changedFiles(applied, d).writes.map((w) => w.path).sort();
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    expect(writes).toEqual([`pages/${pageOf}.json`, revisionsPath("ep001")].sort());
    for (const p of applied.pages[pageOf]!.panels) {
      for (const b of p.balloons) if (b.id !== balloon.id) expect(b).toBe(locate(d, { panel: null, balloon: b.id })!.balloon);
      expect(p.art).toBe(d.pages[pageOf]!.panels.find((x) => x.id === p.id)!.art);
    }
  });

  it("un testo cambiato nel frattempo è un conflitto, non una sovrascrittura", () => {
    const d = add(doc, [correction("Dello sceneggiatore.")]);
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    const edited = applyCommand(d, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Dell'autore." }] });
    expect(revisionConflict(edited, entries(edited)[0]!)).toMatch(/cambiato nel frattempo/);
    expect(() => applyCommand(edited, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT })).toThrow(CommandError);
  });

  it("rifiutare lascia il testo com'è e traccia la decisione", () => {
    const d = add(doc, [correction("No.")]);
    const rejected = applyCommand(d, { type: "revision.reject", chapterId: "ep001", ids: ["r-0001"], by: "autore", at: AT });
    expect(locate(rejected, { panel: null, balloon: balloon.id })!.balloon).toBe(balloon);
    expect(entries(rejected)[0]).toMatchObject({ status: "rejected", resolved_by: "autore" });
  });

  it("aggiungere una battuta crea il balloon con lo speaker, e la voce lo ricorda", () => {
    const d = add(doc, [{ origin: "annotated", kind: "add", panel: talking.id, balloon: null, speaker: "elio", from: null, to: "Aspetta!", source_line: null }]);
    const applied = applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    const entry = entries(applied)[0]!;
    const created = locate(applied, entry)!.balloon!;
    expect(created.text).toEqual([{ t: "Aspetta!" }]);
    expect(created.speaker.ref).toBe("elio");
  });

  it("changelog e copione si salvano e si riaprono", async () => {
    const store = new MemoryProjectStore();
    const d = applyCommand(add(doc, [correction("X.")]), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    await saveProject(store, d, null);
    expect(store.paths()).toContain("revisions/ep001.json");
    expect(store.paths()).toContain("script/ep001.md");
    const { doc: reopened } = await loadProject(store);
    expect(reopened.revisions).toEqual(d.revisions);
    expect(reopened.scripts.ep001).toBe("# copione\n");
  });

  it("undo annulla testo e stato della voce insieme", async () => {
    const { createHistory, execute, undo } = await import("../src/editor/history.js");
    let h = execute(createHistory(add(doc, [correction("Y.")])), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    h = undo(h);
    expect(entries(h.present)[0]!.status).toBe("open");
    expect(locate(h.present, { panel: null, balloon: balloon.id })!.balloon).toBe(balloon);
  });
});

describe("Lint del changelog (Appendice A, Produzione)", () => {
  it("rev del balloon più vecchia della correzione applicata: avviso", () => {
    const applied = applyCommand(add(doc, [correction("Z.")]), { type: "revision.apply", chapterId: "ep001", ids: ["r-0001"], by: "a", at: AT });
    expect(lintRevisions(applied)).toEqual([]);
    // Il file di pagina rimesso da un backup: la rev torna indietro, il changelog no.
    const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
    const restored = { ...applied, pages: { ...applied.pages, [pageOf]: doc.pages[pageOf]! } };
    expect(lintRevisions(restored).map((i) => i.code)).toEqual(["production.stale-rev"]);
  });
});

const pageOf = pages.find((p) => p.panels.some((x) => x.id === talking.id))!.id;
const apply = (d: ProjectDoc, ids: string[], extra: { force?: boolean; resolution?: string } = {}) =>
  applyCommand(d, { type: "revision.apply", chapterId: "ep001", ids, by: "autore", at: AT, ...extra });
const reject = (d: ProjectDoc, ids: string[], resolution?: string) =>
  applyCommand(d, { type: "revision.reject", chapterId: "ep001", ids, by: "autore", at: AT, ...(resolution ? { resolution } : {}) });
const now = (d: ProjectDoc) => locate(d, { panel: null, balloon: balloon.id })!.balloon!;

describe("L'enfasi sopravvive a una correzione", () => {
  const runs = [{ t: "Non c'è più " }, { t: "niente", em: "bold" as const }, { t: " qui dentro." }];

  it("ciò che non cambia tiene la sua enfasi", () => {
    expect(retext(runs, "Qui non c'è più niente qui dentro.")).toEqual([{ t: "Qui non c'è più " }, { t: "niente", em: "bold" }, { t: " qui dentro." }]);
    expect(retext(runs, "Non c'è più niente qui dentro, vero?")).toEqual([{ t: "Non c'è più " }, { t: "niente", em: "bold" }, { t: " qui dentro, vero?" }]);
  });

  it("un cambio dentro un run ne eredita l'enfasi; a cavallo di due, no", () => {
    expect(retext(runs, "Non c'è più nulla qui dentro.")).toEqual([{ t: "Non c'è più " }, { t: "nulla", em: "bold" }, { t: " qui dentro." }]);
    expect(retext(runs, "Non c'è anima viva qui dentro.")).toEqual([{ t: "Non c'è anima viva qui dentro." }]);
  });

  it("testo uguale: gli stessi run", () => {
    expect(retext(runs, "Non c'è più niente qui dentro.")).toEqual(runs);
  });

  it("applicare una correzione non appiattisce la battuta", () => {
    const styled = applyCommand(doc, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Mai", em: "bold" }, { t: " più così." }] });
    const d = apply(add(styled, [correction("Mai più così, capito?", "Mai più così.")]), ["r-0001"]);
    expect(now(d).text).toEqual([{ t: "Mai", em: "bold" }, { t: " più così, capito?" }]);
  });
});

describe("Conflitti: si vedono, e si possono scavalcare sapendolo", () => {
  it("virgolette e spazi di un elaboratore di testi non sono un conflitto", () => {
    const quoted = applyCommand(doc, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "L'ha  detto…" }] });
    const d = add(quoted, [correction("L'ha detto lui.", "L’ha detto...")]);
    expect(revisionConflict(d, entries(d)[0]!, "ep001")).toBeNull();
  });

  it("applicare comunque sovrascrive e registra cosa c'era", () => {
    const d = add(doc, [correction("Dello sceneggiatore.")]);
    const edited = applyCommand(d, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Dell'autore." }] });
    expect(canForceRevision(edited, entries(edited)[0]!, "ep001")).toBe(true);
    const forced = apply(edited, ["r-0001"], { force: true });
    expect(now(forced).text).toEqual([{ t: "Dello sceneggiatore." }]);
    expect(entries(forced)[0]).toMatchObject({ status: "applied", replaced: "Dell'autore." });
  });

  it("un bersaglio che non esiste più non si scavalca", () => {
    const d = add(doc, [{ ...correction("X."), balloon: "non-esiste" }]);
    expect(canForceRevision(d, entries(d)[0]!, "ep001")).toBe(false);
    expect(() => apply(d, ["r-0001"], { force: true })).toThrow(CommandError);
  });

  it("una voce cerca il suo bersaglio solo nel suo capitolo", () => {
    expect(locate(doc, { panel: talking.id, balloon: null }, "ep001")).not.toBeNull();
    const other = applyCommand(doc, { type: "chapter.add", title: "B" });
    expect(locate(other, { panel: talking.id, balloon: null }, "ep002")).toBeNull();
  });

  it("il testo proposto si può correggere prima di accettarlo", () => {
    const d = applyCommand(add(doc, [correction("Quasi giusto.")]), { type: "revision.edit", chapterId: "ep001", id: "r-0001", to: "Giusto." });
    expect(now(apply(d, ["r-0001"])).text).toEqual([{ t: "Giusto." }]);
    expect(() => applyCommand(apply(d, ["r-0001"]), { type: "revision.edit", chapterId: "ep001", id: "r-0001", to: "Tardi." })).toThrow(CommandError);
  });
});

describe("Le decisioni si ricordano e si possono rivedere", () => {
  it("una correzione rifiutata non torna al reimport, e si sa quante", () => {
    const rejected = reject(add(doc, [correction("No.")]), ["r-0001"], "Sara non parla così");
    expect(entries(rejected)[0]).toMatchObject({ status: "rejected", resolution: "Sara non parla così" });
    expect(partitionIncoming(rejected, "ep001", [correction("No."), correction("Sì.")])).toMatchObject({ fresh: [{ to: "Sì." }], alreadyRejected: [{ to: "No." }], alreadyOpen: [] });
    expect(entries(add(rejected, [correction("No.")]))).toHaveLength(1);
  });

  it("chi la scrive di persona la ottiene comunque", () => {
    const rejected = reject(add(doc, [correction("No.")]), ["r-0001"]);
    const again = applyCommand(rejected, { type: "revision.add", chapterId: "ep001", entries: [correction("No.")], by: "autore", at: AT, again: true });
    expect(entries(again).map((e) => e.status)).toEqual(["rejected", "open"]);
  });

  it("trova e sostituisci applica anche dove la stessa correzione era aperta o rifiutata", () => {
    const word = text.split(/\s+/)[0]!.replace(/[^\p{L}]/gu, "");
    const replaced = text.replace(word, "XYZ");
    for (const prepare of [(d: ProjectDoc) => d, (d: ProjectDoc) => reject(d, ["r-0001"])]) {
      const d = prepare(add(doc, [{ ...correction(replaced), origin: "find-replace" }]));
      const done = applyCommand(d, { type: "text.replace", chapterId: "ep001", find: word, replace: "XYZ", options: { matchCase: true, wholeWord: true }, by: "autore", at: AT });
      expect(now(done).text.map((r) => r.t).join("")).toBe(replaced);
      expect(entries(done).some((e) => e.status === "open")).toBe(false);
    }
  });

  it("riaprire rimette in attesa una rifiutata; una applicata no", () => {
    const rejected = reject(add(doc, [correction("No."), correction("Sì.")]), ["r-0001"]);
    const d = applyCommand(apply(rejected, ["r-0002"]), { type: "revision.reopen", chapterId: "ep001", ids: ["r-0001", "r-0002"] });
    expect(entries(d).map((e) => e.status)).toEqual(["open", "applied"]);
    expect(entries(d)[0]).toMatchObject({ resolved_at: null, resolved_by: null, resolution: null });
  });

  it("ripristinare è una correzione inversa, tracciata", () => {
    const applied = apply(add(doc, [correction("Nuovo.")]), ["r-0001"]);
    const back = applyCommand(applied, { type: "revision.revert", chapterId: "ep001", id: "r-0001", by: "autore", at: AT });
    expect(now(back).text.map((r) => r.t).join("")).toBe(text);
    expect(entries(back)[1]).toMatchObject({ origin: "manual", kind: "text", from: "Nuovo.", to: text, status: "applied" });
    // Se nel frattempo il testo è cambiato ancora, non si sovrascrive.
    const edited = applyCommand(applied, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Altro." }] });
    expect(() => applyCommand(edited, { type: "revision.revert", chapterId: "ep001", id: "r-0001", by: "autore", at: AT })).toThrow(CommandError);
  });
});

describe("Ambito: campi, pagine, scene, capitolo", () => {
  const set = (field: NonNullable<NewRevision["field"]>, from: string, to: string, onBalloon = true): NewRevision => ({
    origin: "annotated", kind: "set", field, panel: talking.id, balloon: onBalloon ? balloon.id : null, speaker: null, from, to, source_line: null,
  });

  it("chi parla e il tipo di battuta si correggono senza toccare il testo", () => {
    const d = apply(add(doc, [set("speaker", balloon.speaker.ref ?? "", "elio"), set("balloon_type", balloon.type, "whisper")]), ["r-0001", "r-0002"]);
    expect(now(d)).toMatchObject({ type: "whisper", text: balloon.text, rev: balloon.rev });
    expect(now(d).speaker).toEqual({ ...balloon.speaker, ref: "elio" });
  });

  it("il luogo di un pannello si corregge, e un tipo che non esiste no", () => {
    const d = apply(add(doc, [set("setting", talking.setting, "molo, notte", false)]), ["r-0001"]);
    expect(locate(d, { panel: talking.id, balloon: null })!.panel.setting).toBe("molo, notte");
    const bad = add(doc, [set("balloon_type", balloon.type, "cantato")]);
    expect(revisionConflict(bad, entries(bad)[0]!)).toMatch(/non è un tipo/);
  });

  it("una nota dichiara a cosa si riferisce, e si chiude dicendo cosa si è fatto", () => {
    const note = (extra: Partial<NewRevision>): NewRevision => ({ origin: "manual", kind: "note", panel: null, balloon: null, speaker: null, from: null, to: "Da rivedere", source_line: null, ...extra });
    const d = add(doc, [note({}), note({ page: pageOf }), note({ scene: sampleScene.id }), note({ panel: talking.id })]);
    expect(entries(d).map(revisionScope)).toEqual(["chapter", "page", "scene", "panel"]);
    const done = apply(d, ["r-0002"], { resolution: "Pagina spezzata in due" });
    expect(entries(done)[1]).toMatchObject({ status: "applied", resolution: "Pagina spezzata in due" });
    const reopened = applyCommand(done, { type: "revision.reopen", chapterId: "ep001", ids: ["r-0002"] });
    expect(entries(reopened)[1]!.status).toBe("open");
  });

  it("un changelog scritto prima di questi campi si rilegge", () => {
    const old = { schema: 1, chapter_id: "ep001", entries: [{ id: "r-0001", at: AT, by: "s", origin: "annotated", kind: "text", panel: "p", balloon: "b", from: "a", to: "b", status: "open" }] };
    expect(RevisionsDocSchema.parse(old).entries[0]).toMatchObject({ page: null, scene: null, field: null, lesson: null, resolution: null, replaced: null });
  });
});

describe("Che fine ha fatto una correzione applicata", () => {
  it("in vigore, superata da una modifica successiva, persa con il suo pannello", () => {
    const applied = apply(add(doc, [correction("Nuovo.")]), ["r-0001"]);
    expect(revisionState(applied, entries(applied)[0]!, "ep001")).toBe("current");
    const edited = applyCommand(applied, { type: "balloon.text", pageId: pageOf, balloonId: balloon.id, text: [{ t: "Altro." }] });
    expect(revisionState(edited, entries(edited)[0]!, "ep001")).toBe("superseded");
    // Lo spoglio rifatto: il capitolo riparte da pagine nuove, il changelog resta.
    const respogliato = applyCommand(applied, { type: "chapter.set-content", chapterId: "ep001", pages: [], scenes: [] });
    expect(revisionState(respogliato, entries(respogliato)[0]!, "ep001")).toBe("lost");
    expect(lintRevisions(respogliato).map((i) => i.code)).toEqual(["revision.lost"]);
    expect(revisionState(doc, { ...entries(applied)[0]!, status: "open" }, "ep001")).toBeNull();
  });
});

describe("Memoria: le correzioni diventano regole per la serie", () => {
  it("la lezione scritta su una voce si raccoglie da tutti i capitoli, senza doppioni", () => {
    let d = add(doc, [correction("Uno."), correction("Due."), correction("Tre.")]);
    d = applyCommand(d, { type: "revision.lesson", chapterId: "ep001", id: "r-0001", lesson: "  Sara non dà   mai del lei. " });
    d = applyCommand(d, { type: "revision.lesson", chapterId: "ep001", id: "r-0002", lesson: "sara non dà mai del lei." });
    d = applyCommand(d, { type: "revision.lesson", chapterId: "ep001", id: "r-0003", lesson: "Niente punti esclamativi doppi." });
    expect(seriesLessons(d)).toEqual([
      { chapterId: "ep001", id: "r-0001", text: "Sara non dà mai del lei." },
      { chapterId: "ep001", id: "r-0003", text: "Niente punti esclamativi doppi." },
    ]);
    // Oltre il limite restano le più recenti.
    expect(seriesLessons(d, 35).map((l) => l.id)).toEqual(["r-0003"]);
    const cleared = applyCommand(d, { type: "revision.lesson", chapterId: "ep001", id: "r-0003", lesson: null });
    expect(seriesLessons(cleared).map((l) => l.id)).toEqual(["r-0001"]);
  });

  it("la proposta parte dal prima e dal dopo", () => {
    expect(suggestLesson({ kind: "text", field: null, from: "Vabbè.", to: "Va bene.", speaker: null })).toBe("Non «Vabbè.» ma «Va bene.».");
  });
});

describe("Diff a parole", () => {
  it("dice cosa resta, cosa esce e cosa entra", () => {
    expect(diffWords("Non c'è più niente qui.", "Non c'è più nulla qui.")).toEqual([
      { kind: "same", text: "Non c'è più " },
      { kind: "del", text: "niente" },
      { kind: "ins", text: "nulla" },
      { kind: "same", text: " qui." },
    ]);
    expect(diffWords("uguale", "uguale")).toEqual([{ kind: "same", text: "uguale" }]);
    expect(diffWords("", "nuovo")).toEqual([{ kind: "ins", text: "nuovo" }]);
  });
});
