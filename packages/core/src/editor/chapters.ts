import type { ProjectDoc } from "../document/projectDoc.js";
import type { Chapter } from "../schema/chapters.js";
import type { Page } from "../schema/page.js";
import type { Scene } from "../schema/scenes.js";

/**
 * Un'opera ha più capitoli (§5.3: `chapters.json`). Qui le operazioni che
 * li riguardano interi: aggiungerne uno, rinominarlo, riempirlo con uno
 * spoglio — senza mai toccare gli altri.
 */

/** Id del prossimo capitolo: `ep` + numero a tre cifre, oltre il più alto mai usato. */
export function nextChapterId(doc: ProjectDoc): { id: string; number: number } {
  let highest = 0;
  for (const chapter of doc.chapters.chapters) {
    highest = Math.max(highest, chapter.number, Number(/^ep(\d+)$/.exec(chapter.id)?.[1] ?? 0));
  }
  const number = highest + 1;
  return { id: `ep${String(number).padStart(3, "0")}`, number };
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
 * Cosa sa il modello degli altri capitoli quando ne spoglia uno nuovo: i
 * personaggi già esistenti (ref e nome, perché «Sara» resti `sara`) e un
 * riassunto breve del capitolo precedente, per la continuità. Breve di
 * proposito: è contesto, non un secondo capitolo da spogliare.
 */
export interface ChapterContext {
  characters: Array<{ ref: string; name: string }>;
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
  const characters = [...refs].sort().map((ref) => ({ ref, name: doc.characters[ref]?.name ?? "" }));

  const chapters = [...doc.chapters.chapters].sort((a, b) => a.number - b.number);
  const index = chapters.findIndex((c) => c.id === chapterId);
  const previous = [...chapters.slice(0, Math.max(0, index))].reverse().find((c) => c.pages.length > 0);
  if (!previous) return { characters, previously: null };

  const sceneIds = chapterSceneIds(doc, previous.id);
  const lines = doc.scenes.scenes
    .filter((s) => sceneIds.has(s.id))
    .map((s) => `- ${s.title} (${s.location}, ${s.time_of_day}): ${s.beats.map((b) => b.summary).filter(Boolean).slice(0, 3).join(" ")}`);
  let text = `Capitolo ${previous.number} «${previous.title}»:\n${lines.join("\n")}`;
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return { characters, previously: text };
}
