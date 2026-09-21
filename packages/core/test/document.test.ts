import { describe, expect, it } from "vitest";
import { sampleProject, sampleScene } from "../src/fixtures/index.js";
import { buildPagesFromScene } from "../src/script/buildPages.js";
import { MemoryProjectStore, type ProjectStore } from "../src/document/store.js";
import {
  JOURNAL_FILE,
  loadProject,
  pagePath,
  projectDocFrom,
  ProjectLoadError,
  saveProject,
  serialize,
  type ProjectDoc,
} from "../src/document/projectDoc.js";
import { acquireLock, LOCK_FILE, LOCK_TTL_MS, releaseLock } from "../src/document/lock.js";
import { migrate, MigrationError } from "../src/document/migrate.js";

const pages = buildPagesFromScene({
  scene: sampleScene,
  chapterId: "ep001",
  firstPageNumber: 1,
  primaryTarget: "digital-page",
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});

const doc: ProjectDoc = projectDocFrom({
  project: sampleProject,
  scenes: [sampleScene],
  chapter: { id: "ep001", number: 1, title: "Il faro" },
  pages,
});

function withFirstPage(d: ProjectDoc, change: (p: (typeof pages)[number]) => (typeof pages)[number]): ProjectDoc {
  const id = pages[0]!.id;
  return { ...d, pages: { ...d.pages, [id]: change(d.pages[id]!) } };
}

describe("Progetto = cartella (§5.1)", () => {
  it("salva i file previsti e li riapre identici", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    expect(store.paths()).toEqual(["chapters.json", "project.json", "scenes.json", ...pages.map((p) => pagePath(p.id))].sort());

    const { doc: reopened, issues } = await loadProject(store);
    expect(issues).toEqual([]);
    expect(reopened).toEqual(doc);
  });

  it("la serializzazione è stabile: stesso documento, stessi byte", async () => {
    const a = new MemoryProjectStore();
    const b = new MemoryProjectStore();
    await saveProject(a, doc, null);
    await saveProject(b, (await loadProject(a)).doc, null);
    for (const path of a.paths()) expect(await b.readText(path)).toBe(await a.readText(path));
  });
});

describe("Salvataggio incrementale: si scrive solo ciò che è cambiato", () => {
  it("una modifica a una pagina scrive quella pagina e basta", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    store.writes.length = 0;

    const next = withFirstPage(doc, (p) => ({ ...p, spread_with: null, order: p.order }));
    const result = await saveProject(store, next, doc);
    expect(result.written).toEqual([pagePath(pages[0]!.id)]);
    // Un file solo: niente journal, la scrittura atomica basta.
    expect(store.writes).toEqual([pagePath(pages[0]!.id)]);
  });

  it("nessuna modifica, nessuna scrittura", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    expect(await saveProject(store, doc, doc)).toEqual({ written: [], removed: [] });
  });

  it("una pagina tolta dal documento sparisce anche dalla cartella", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    const removedId = pages.at(-1)!.id;
    const rest = Object.fromEntries(Object.entries(doc.pages).filter(([id]) => id !== removedId));
    const next: ProjectDoc = {
      ...doc,
      pages: rest,
      chapters: { ...doc.chapters, chapters: doc.chapters.chapters.map((c) => ({ ...c, pages: c.pages.filter((id) => id !== removedId) })) },
    };
    const result = await saveProject(store, next, doc);
    expect(result.removed).toEqual([pagePath(removedId)]);
    expect(store.paths()).not.toContain(pagePath(removedId));
    expect(store.paths()).not.toContain(JOURNAL_FILE);
  });
});

/** Store che si "spegne" dopo N scritture: simula un crash a metà salvataggio. */
function crashingAfter(inner: MemoryProjectStore, writes: number): ProjectStore {
  let left = writes;
  return {
    label: inner.label,
    readText: (p) => inner.readText(p),
    readBytes: (p) => inner.readBytes(p),
    list: (d) => inner.list(d),
    remove: (p) => inner.remove(p),
    writeBytes: (p, d) => inner.writeBytes(p, d),
    writeText: (p, t) => {
      if (left-- <= 0) return Promise.reject(new Error("crash"));
      return inner.writeText(p, t);
    },
  };
}

describe("Scritture atomiche e journal (§11.3)", () => {
  it("un crash a metà di un salvataggio multi-file si completa alla riapertura", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);

    // Cambiano due pagine e il capitolo: tre file più il journal.
    const retitled = { ...doc.chapters, chapters: doc.chapters.chapters.map((c) => ({ ...c, title: "Il faro spento" })) };
    const next = { ...withFirstPage(doc, (p) => ({ ...p, order: 1 })), chapters: retitled };
    // Journal + un file, poi il crash.
    await expect(saveProject(crashingAfter(store, 2), next, doc)).rejects.toThrow("crash");
    expect(store.paths()).toContain(JOURNAL_FILE);

    const { doc: reopened, recovered, issues } = await loadProject(store);
    expect(recovered).toBe(true);
    expect(issues.map((i) => i.code)).toContain("project.recovered");
    expect(reopened.chapters.chapters[0]!.title).toBe("Il faro spento");
    expect(store.paths()).not.toContain(JOURNAL_FILE);
  });

  it("un crash prima che il journal sia scritto lascia il progetto com'era", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    const retitled = { ...doc.chapters, chapters: doc.chapters.chapters.map((c) => ({ ...c, title: "altro" })) };
    await expect(saveProject(crashingAfter(store, 0), { ...doc, chapters: retitled, project: { ...doc.project, title: "x" } }, doc)).rejects.toThrow();
    const { doc: reopened, recovered } = await loadProject(store);
    expect(recovered).toBe(false);
    expect(reopened).toEqual(doc);
  });
});

describe("Apertura: errori di struttura bloccano, incoerenze avvisano", () => {
  it("una cartella senza project.json non è un progetto", async () => {
    await expect(loadProject(new MemoryProjectStore("vuota"))).rejects.toThrow(ProjectLoadError);
  });

  it("un JSON rotto ferma l'apertura, dicendo quale file", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    await store.writeText(pagePath(pages[0]!.id), "{ rotto");
    await expect(loadProject(store)).rejects.toThrow(pagePath(pages[0]!.id));
  });

  it("pagina elencata ma mancante, e file orfano: avvisi, il progetto si apre", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    await store.remove(pagePath(pages[0]!.id));
    await store.writeText("pages/dimenticata.json", serialize({ ...pages[0]!, id: "dimenticata" }));
    const { issues } = await loadProject(store);
    expect(issues.map((i) => i.code).sort()).toEqual(["project.missing-page", "project.orphan-page"]);
  });

  it("un file di una versione futura non si apre: salvarlo perderebbe dati", async () => {
    expect(() => migrate("page", { schema: 99 }, "x.json")).toThrow(MigrationError);
    expect(() => migrate("page", { nope: 1 }, "x.json")).toThrow(/schema/);
    expect(migrate("page", { schema: 1, a: 2 }, "x.json")).toEqual({ schema: 1, a: 2 });
  });
});

describe("Lock file", () => {
  const t0 = new Date("2026-09-21T10:00:00Z");

  it("una seconda sessione vede il lock, e chi lo tiene", async () => {
    const store = new MemoryProjectStore();
    expect(await acquireLock(store, "A", "Chrome", t0)).toEqual({ acquired: true });
    const second = await acquireLock(store, "B", "Firefox", new Date(t0.getTime() + 1000));
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.held.holder).toBe("Chrome");
  });

  it("un lock scaduto (sessione morta) si prende", async () => {
    const store = new MemoryProjectStore();
    await acquireLock(store, "A", "Chrome", t0);
    const later = new Date(t0.getTime() + LOCK_TTL_MS + 1);
    expect(await acquireLock(store, "B", "Firefox", later)).toEqual({ acquired: true });
  });

  it("con force si prende comunque; si rilascia solo il proprio", async () => {
    const store = new MemoryProjectStore();
    await acquireLock(store, "A", "Chrome", t0);
    expect(await acquireLock(store, "B", "Firefox", t0, { force: true })).toEqual({ acquired: true });
    await releaseLock(store, "A");
    expect(store.paths()).toContain(LOCK_FILE);
    await releaseLock(store, "B");
    expect(store.paths()).not.toContain(LOCK_FILE);
  });
});

describe("Nessun documento non valido su disco", () => {
  it("il salvataggio si rifiuta prima di scrivere qualunque cosa", async () => {
    const store = new MemoryProjectStore();
    await saveProject(store, doc, null);
    store.writes.length = 0;
    const broken = withFirstPage(doc, (p) => ({ ...p, order: -3 }));
    await expect(saveProject(store, broken, doc)).rejects.toThrow(/rifiutato/);
    expect(store.writes).toEqual([]);
  });
});
