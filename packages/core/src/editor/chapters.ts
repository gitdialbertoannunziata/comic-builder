import type { ProjectDoc } from "../document/projectDoc.js";
import type { Chapter } from "../schema/chapters.js";
import type { Page } from "../schema/page.js";
import type { Scene } from "../schema/scenes.js";
import { appearanceText } from "../compile/promptCompiler.js";
import { seriesLessons } from "../revisions/lessons.js";

/**
 * Un'opera ha più capitoli (§5.3: `chapters.json`). Qui le operazioni che
 * li riguardano interi: aggiungerne uno, rinominarlo, spostarlo, eliminarlo,
 * riempirlo con uno spoglio — senza mai toccare gli altri.
 */

/** L'indice in fondo all'id di un capitolo (`ep012` → 12); 0 se l'id ha un'altra forma. */
function chapterIndex(id: string): number {
  return Number(/^ep(\d+)$/.exec(id)?.[1] ?? 0);
}

/** I capitoli nell'ordine dell'opera: per numero, e a parità come stanno nel file. */
function inOrder(chapters: readonly Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.number - b.number);
}

/**
 * Id e numero del prossimo capitolo. L'id è `ep` + tre cifre, oltre il più
 * alto mai usato — anche da un capitolo eliminato (`chapter_seq`). Il numero
 * è il posto nell'opera, dopo l'ultimo: da quando i capitoli si spostano e si
 * eliminano le due cose non coincidono più, come `id` e `order` di una pagina.
 */
export function nextChapterId(doc: ProjectDoc): { id: string; number: number } {
  let index = doc.chapters.chapter_seq ?? 0;
  let number = 0;
  for (const chapter of doc.chapters.chapters) {
    index = Math.max(index, chapterIndex(chapter.id));
    number = Math.max(number, chapter.number);
  }
  return { id: `ep${String(index + 1).padStart(3, "0")}`, number: number + 1 };
}

export function addChapter(doc: ProjectDoc, title: string): ProjectDoc {
  const { id, number } = nextChapterId(doc);
  const chapter: Chapter = { id, number, title: title.trim() || `Capitolo ${number}`, status: "planned", pages: [] };
  return { ...doc, chapters: { ...doc.chapters, chapters: [...doc.chapters.chapters, chapter] } };
}

export function updateChapter(doc: ProjectDoc, chapterId: string, patch: Partial<Pick<Chapter, "title" | "status">>): ProjectDoc {
  return {
    ...doc,
    chapters: { ...doc.chapters, chapters: doc.chapters.chapters.map((c) => (c.id === chapterId ? { ...c, ...patch } : c)) },
  };
}

/**
 * I capitoli nell'ordine dato, coi numeri ridistribuiti in fila: `number`
 * segue la posizione come `order` quella di una pagina (§5.4), mentre l'id
 * resta quello (§5.3) — `ep003` può diventare il capitolo 1. I numeri in uso
 * restano gli stessi e cambiano di mano: un'opera che parte dal 12 resta dal 12.
 */
function renumbered(ordered: readonly Chapter[], numbers: readonly number[]): Chapter[] {
  return ordered.map((c, i) => (c.number === numbers[i] ? c : { ...c, number: numbers[i]! }));
}

/** Sposta un capitolo al posto `toIndex` nell'ordine dell'opera (0 = primo). Gli altri scalano. */
export function moveChapter(doc: ProjectDoc, chapterId: string, toIndex: number): ProjectDoc {
  const ordered = inOrder(doc.chapters.chapters);
  const numbers = ordered.map((c) => c.number);
  const from = ordered.findIndex((c) => c.id === chapterId);
  if (from < 0) throw new Error(`Capitolo ${chapterId} inesistente`);
  const [moved] = ordered.splice(from, 1);
  const to = Math.max(0, Math.min(ordered.length, toIndex));
  if (to === from) return doc;
  ordered.splice(to, 0, moved!);
  return { ...doc, chapters: { ...doc.chapters, chapters: renumbered(ordered, numbers) } };
}

/**
 * Le regole per la serie (`lesson`, vedi `seriesLessons`) che stanno solo nel
 * changelog di un capitolo: non le ripete un altro capitolo e non sono già
 * fra le regole della serie. Eliminando il capitolo sparirebbero con lui.
 */
export function lessonsOnlyIn(doc: ProjectDoc, chapterId: string): string[] {
  const key = (text: string) => text.trim().toLowerCase();
  const elsewhere = new Set(doc.project.series_notes.split("\n").map(key));
  for (const [id, revs] of Object.entries(doc.revisions)) {
    if (id !== chapterId) for (const entry of revs.entries) if (entry.lesson?.trim()) elsewhere.add(key(entry.lesson));
  }
  const own: string[] = [];
  for (const entry of doc.revisions[chapterId]?.entries ?? []) {
    const text = entry.lesson?.trim();
    if (!text || elsewhere.has(key(text))) continue;
    elsewhere.add(key(text));
    own.push(text);
  }
  return own;
}

/**
 * Elimina un capitolo con ciò che è solo suo: pagine, copione, changelog e
 * le scene che nessun altro capitolo usa. I capitoli dopo scalano di un
 * numero. Restano i personaggi, che sono dell'opera, e ciò che l'autore ha
 * tratto dalle sue correzioni: quelle regole valgono per la serie, e passano
 * fra le regole scritte (`series_notes`) invece di sparire dallo spoglio dei
 * capitoli che restano. I file in `art/` e `renders/` non si toccano: l'arte
 * dell'autore non la cancella lo strumento (§5.1), ed è per questo che l'id
 * del capitolo resta speso.
 */
export function removeChapter(doc: ProjectDoc, chapterId: string): ProjectDoc {
  const ordered = inOrder(doc.chapters.chapters);
  const chapter = ordered.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Capitolo ${chapterId} inesistente`);
  const rest = ordered.filter((c) => c.id !== chapterId);

  const own = chapterSceneIds(doc, chapterId);
  for (const other of rest) chapterSceneIds(doc, other.id).forEach((id) => own.delete(id));
  const scenes = doc.scenes.scenes.filter((s) => !own.has(s.id));

  const without = <T>(record: Readonly<Record<string, T>>, gone: (id: string) => boolean) =>
    Object.keys(record).some(gone) ? Object.fromEntries(Object.entries(record).filter(([id]) => !gone(id))) : record;

  const lessons = lessonsOnlyIn(doc, chapterId);
  return {
    ...doc,
    project: lessons.length === 0 ? doc.project : { ...doc.project, series_notes: [doc.project.series_notes.trimEnd(), ...lessons].filter(Boolean).join("\n") },
    pages: without(doc.pages, (id) => chapter.pages.includes(id)),
    scenes: scenes.length === doc.scenes.scenes.length ? doc.scenes : { ...doc.scenes, scenes },
    chapters: {
      ...doc.chapters,
      chapters: renumbered(rest, ordered.map((c) => c.number)),
      chapter_seq: Math.max(doc.chapters.chapter_seq ?? 0, ...ordered.map((c) => chapterIndex(c.id))),
    },
    revisions: without(doc.revisions, (id) => id === chapterId),
    scripts: without(doc.scripts, (id) => id === chapterId),
  };
}

/** Le scene usate dalle pagine di un capitolo. */
export function chapterSceneIds(doc: ProjectDoc, chapterId: string): Set<string> {
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  const ids = new Set<string>();
  for (const pageId of chapter?.pages ?? []) for (const panel of doc.pages[pageId]?.panels ?? []) ids.add(panel.scene_id);
  return ids;
}

/**
 * Riempie un capitolo con uno spoglio: le sue pagine e le sue scene vengono
 * sostituite, quelle degli altri capitoli restano gli stessi oggetti (e il
 * salvataggio non le riscrive). Una scena condivisa con un altro capitolo
 * non si toglie: la usa ancora qualcuno.
 */
export function setChapterContent(
  doc: ProjectDoc,
  chapterId: string,
  content: { pages: readonly Page[]; scenes: readonly Scene[]; script?: string },
): ProjectDoc {
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Capitolo ${chapterId} inesistente`);

  const oldScenes = chapterSceneIds(doc, chapterId);
  const usedElsewhere = new Set<string>();
  for (const other of doc.chapters.chapters) {
    if (other.id === chapterId) continue;
    chapterSceneIds(doc, other.id).forEach((id) => usedElsewhere.add(id));
  }

  const ordered = [...content.pages].sort((a, b) => a.order - b.order);
  const pages: Record<string, Page> = {};
  for (const [id, page] of Object.entries(doc.pages)) if (!chapter.pages.includes(id)) pages[id] = page;
  for (const page of ordered) pages[page.id] = page;

  const incoming = new Set(content.scenes.map((s) => s.id));
  const scenes = [
    ...doc.scenes.scenes.filter((s) => !incoming.has(s.id) && (!oldScenes.has(s.id) || usedElsewhere.has(s.id))),
    ...content.scenes,
  ];

  return {
    ...doc,
    pages,
    scenes: { ...doc.scenes, scenes },
    chapters: {
      ...doc.chapters,
      chapters: doc.chapters.chapters.map((c) =>
        c.id === chapterId
          ? { ...c, pages: ordered.map((p) => p.id), status: c.status === "planned" ? "scripting" : c.status, page_seq: Math.max(c.page_seq ?? 0, ordered.length) }
          : c,
      ),
    },
    scripts: content.script === undefined ? doc.scripts : { ...doc.scripts, [chapterId]: content.script },
  };
}

/**
 * Cosa sa il modello dell'opera quando spoglia un capitolo: i personaggi con
 * la loro scheda (perché «Sara» resti `sara`, e la si riconosca anche se il
 * testo la descrive senza nominarla), i costumi, i luoghi già visti, le
 * regole della serie e un riassunto breve del capitolo precedente. Breve di
 * proposito: è contesto, non un secondo capitolo da spogliare.
 */
export interface ChapterContext {
  /**
   * I personaggi dell'opera, con ciò che la scheda dice di loro: nome, chi
   * sono, com'è fatto, i costumi. Serve a riconoscerli nel testo («la donna
   * con la cicatrice» è sara) e a scegliere il costume giusto per ogni beat.
   */
  characters: Array<{ ref: string; name: string; summary?: string; appearance?: string; wardrobe?: Record<string, string> }>;
  /** Luoghi già visti negli altri capitoli: si riusano con lo stesso nome. */
  locations: string[];
  /** Le regole della serie (`project.series_notes`). */
  notes: string;
  /**
   * Ciò che l'autore ha tratto dalle correzioni già fatte, in tutti i
   * capitoli (`lesson` sulle voci del changelog): perché lo stesso errore
   * non torni allo spoglio dopo.
   */
  lessons: string[];
  previously: string | null;
}

export function chapterContext(doc: ProjectDoc, chapterId: string, maxChars = 1500): ChapterContext {
  const refs = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      panel.characters.forEach((c) => refs.add(c.ref));
      panel.balloons.forEach((b) => b.speaker.ref && refs.add(b.speaker.ref));
    }
  }
  Object.keys(doc.characters).forEach((r) => refs.add(r));
  const characters = [...refs].sort().map((ref) => {
    const sheet = doc.characters[ref];
    if (!sheet) return { ref, name: "" };
    const appearance = appearanceText(sheet);
    return {
      ref,
      name: sheet.name,
      ...(sheet.summary ? { summary: sheet.summary } : {}),
      ...(appearance ? { appearance } : {}),
      ...(Object.keys(sheet.wardrobe).length > 0 ? { wardrobe: sheet.wardrobe } : {}),
    };
  });

  // I luoghi delle scene degli altri capitoli, senza ripetizioni.
  const here = chapterSceneIds(doc, chapterId);
  const locations = [...new Set(doc.scenes.scenes.filter((s) => !here.has(s.id)).map((s) => s.location.trim()).filter(Boolean))];
  const notes = doc.project.series_notes.trim();
  const lessons = seriesLessons(doc).map((l) => l.text);

  const chapters = [...doc.chapters.chapters].sort((a, b) => a.number - b.number);
  const index = chapters.findIndex((c) => c.id === chapterId);
  const previous = [...chapters.slice(0, Math.max(0, index))].reverse().find((c) => c.pages.length > 0);
  if (!previous) return { characters, locations, notes, lessons, previously: null };

  const sceneIds = chapterSceneIds(doc, previous.id);
  const lines = doc.scenes.scenes
    .filter((s) => sceneIds.has(s.id))
    .map((s) => `- ${s.title} (${s.location}, ${s.time_of_day}): ${s.beats.map((b) => b.summary).filter(Boolean).slice(0, 3).join(" ")}`);
  let text = `Capitolo ${previous.number} «${previous.title}»:\n${lines.join("\n")}`;
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return { characters, locations, notes, lessons, previously: text };
}
