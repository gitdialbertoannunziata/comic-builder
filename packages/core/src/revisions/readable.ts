import type { ProjectDoc } from "../document/projectDoc.js";
import type { Balloon } from "../schema/balloon.js";
import type { Panel } from "../schema/panel.js";
import type { NewRevision } from "./revisionCommands.js";

/**
 * Export leggibile e import annotato (§10.1, passi 2 e 3).
 *
 * Il capitolo esce come testo, con gli id stabili fra parentesi quadre. Lo
 * sceneggiatore corregge dove preferisce — Word, Docs, un editor di testo —
 * e il file torna indietro: ogni differenza diventa una correzione da
 * accettare o rifiutare, non una modifica già fatta.
 *
 * Il formato è pensato per sopravvivere a chi lo maneggia: testo puro, id
 * fra parentesi quadre (che nessun elaboratore di testi tocca), e un
 * confronto che ignora ciò che Word cambia da solo — virgolette curve,
 * puntini di sospensione, spazi non separabili. Una riga cancellata per
 * sbaglio non toglie una battuta: per toglierla lo si scrive.
 */

export const REMOVE_MARK = "[togli]";

const TYPE_LABEL: Record<Balloon["type"], string> = {
  speech: "",
  thought: "pensiero",
  whisper: "sussurro",
  shout: "urlo",
  caption: "didascalia",
  sfx: "effetto",
  offpanel: "fuori campo",
};

const plain = (b: Balloon) => b.text.map((r) => r.t).join("");

/** L'etichetta di una battuta: chi parla in maiuscolo, e il tipo quando non è parlato normale. */
function label(balloon: Balloon): string {
  const type = TYPE_LABEL[balloon.type];
  const who = balloon.speaker.ref ? balloon.speaker.ref.toUpperCase().replace(/_/g, " ") : "";
  if (who && type) return `${who} (${type}): `;
  if (who) return `${who}: `;
  return `(${type || "senza voce"}) `;
}

function chapterPanels(doc: ProjectDoc, chapterId: string): Array<{ pageId: string; order: number; panels: Panel[] }> {
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Capitolo ${chapterId} inesistente`);
  return chapter.pages.flatMap((id) => {
    const page = doc.pages[id];
    if (!page) return [];
    const order = page.layout.mode === "page" ? page.layout.reading_order : page.layout.sequence;
    const byId = new Map(page.panels.map((p) => [p.id, p]));
    return [{ pageId: page.id, order: page.order, panels: order.map((pid) => byId.get(pid)).filter((p): p is Panel => p !== undefined) }];
  });
}

export function exportReadable(doc: ProjectDoc, chapterId: string): string {
  const chapter = doc.chapters.chapters.find((c) => c.id === chapterId)!;
  const lines: string[] = [
    `# ${doc.project.title} — Capitolo ${chapter.number}: ${chapter.title}`,
    "",
    `Capitolo: ${chapter.id}`,
    "",
    "Come correggere:",
    "- cambia il testo di una battuta dopo i due punti; lascia com'è il codice fra parentesi quadre;",
    `- per togliere una battuta scrivi ${REMOVE_MARK} al posto del testo;`,
    "- per aggiungerne una, scrivi sotto il pannello una riga «+ NOME: testo»;",
    "- per una nota su un pannello, scrivi sotto una riga che comincia con «>»;",
    "- l'azione del pannello si corregge dopo «Azione:».",
    "",
  ];
  for (const { order, panels } of chapterPanels(doc, chapterId)) {
    lines.push(`## Pagina ${order}`, "");
    for (const panel of panels) {
      lines.push(`### [${panel.id}]`);
      lines.push(`Azione: ${panel.action}`);
      for (const balloon of panel.balloons) lines.push(`- [${balloon.id}] ${label(balloon)}${plain(balloon)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * Ciò che un elaboratore di testi cambia da solo e che non è una correzione.
 * Si confronta su questa forma; se diverge, la correzione riporta il testo
 * così come l'ha scritto lo sceneggiatore.
 */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Toglie l'etichetta generata («SARA: », «(didascalia) », «ELIO (sussurro): »), se c'è. */
function stripLabel(rest: string): string {
  const paren = /^\((?:[^)]*)\)\s*/.exec(rest);
  if (paren) return rest.slice(paren[0].length);
  // Solo un nome tutto in maiuscolo conta come etichetta: «Attento: arriva!» è testo.
  const named = /^([A-ZÀ-Ü0-9_' ]+?)(?:\s*\([^)]*\))?:\s*/.exec(rest);
  if (named && /[A-ZÀ-Ü]/.test(named[1]!)) return rest.slice(named[0].length);
  return rest;
}

/** Da un nome scritto a mano al ref del personaggio: minuscolo, senza accenti né spazi (§5.3). */
export function refFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export interface ImportResult {
  corrections: NewRevision[];
  /** Cose che non sono correzioni ma che l'utente deve sapere: righe sparite, id sconosciuti. */
  warnings: string[];
}

const PANEL_LINE = /^#{1,6}\s*\[([^\]]+)\]/;
const BALLOON_LINE = /^\s*[-*•–—]\s*\[([^\]]+)\]\s?(.*)$/;
const ACTION_LINE = /^\s*Azione:\s?(.*)$/i;
const ADD_LINE = /^\s*\+\s*(.+)$/;
const NOTE_LINE = /^\s*>\s?(.+)$/;
const CHAPTER_LINE = /^\s*Capitolo:\s*(\S+)/;

export function parseAnnotated(doc: ProjectDoc, chapterId: string, text: string): ImportResult {
  const corrections: NewRevision[] = [];
  const warnings: string[] = [];
  const panels = new Map<string, Panel>();
  const balloons = new Map<string, { panel: Panel; balloon: Balloon }>();
  for (const { panels: list } of chapterPanels(doc, chapterId)) {
    for (const panel of list) {
      panels.set(panel.id, panel);
      for (const balloon of panel.balloons) balloons.set(balloon.id, { panel, balloon });
    }
  }

  const seen = new Set<string>();
  let current: Panel | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const chapterMatch = CHAPTER_LINE.exec(line);
    if (chapterMatch && chapterMatch[1] !== chapterId) {
      warnings.push(`Il file è del capitolo ${chapterMatch[1]}, non di ${chapterId}: controlla di aver scelto quello giusto.`);
    }

    const panelMatch = PANEL_LINE.exec(line);
    if (panelMatch) {
      current = panels.get(panelMatch[1]!.trim()) ?? null;
      if (!current) warnings.push(`Riga ${lineNumber}: il pannello [${panelMatch[1]}] non esiste in questo capitolo.`);
      else seen.add(current.id);
      return;
    }

    const balloonMatch = BALLOON_LINE.exec(line);
    if (balloonMatch) {
      const id = balloonMatch[1]!.trim();
      const found = balloons.get(id);
      if (!found) {
        warnings.push(`Riga ${lineNumber}: la battuta [${id}] non esiste in questo capitolo.`);
        return;
      }
      seen.add(id);
      const written = stripLabel(balloonMatch[2] ?? "").trim();
      const before = plain(found.balloon);
      const base = { origin: "annotated" as const, panel: found.panel.id, balloon: id, speaker: null, source_line: found.panel.source?.from_line ?? null };
      if (normalizeForCompare(written).toLowerCase() === REMOVE_MARK) {
        corrections.push({ ...base, kind: "remove", from: before, to: null });
      } else if (normalizeForCompare(written) !== normalizeForCompare(before)) {
        corrections.push({ ...base, kind: "text", from: before, to: written });
      }
      return;
    }

    if (!current) return;
    const panel: Panel = current;

    const actionMatch = ACTION_LINE.exec(line);
    if (actionMatch) {
      const written = (actionMatch[1] ?? "").trim();
      if (normalizeForCompare(written) !== normalizeForCompare(panel.action)) {
        corrections.push({ origin: "annotated", kind: "action", panel: panel.id, balloon: null, speaker: null, from: panel.action, to: written, source_line: panel.source?.from_line ?? null });
      }
      return;
    }

    const addMatch = ADD_LINE.exec(line);
    if (addMatch) {
      const rest = addMatch[1]!.trim();
      const named = /^([A-ZÀ-Üa-zà-ü][\wÀ-ü' ]*?):\s*(.+)$/.exec(rest);
      corrections.push({
        origin: "annotated",
        kind: "add",
        panel: panel.id,
        balloon: null,
        speaker: named ? refFromName(named[1]!) : null,
        from: null,
        to: (named ? named[2]! : rest).trim(),
        source_line: panel.source?.from_line ?? null,
      });
      return;
    }

    const noteMatch = NOTE_LINE.exec(line);
    if (noteMatch) {
      corrections.push({ origin: "annotated", kind: "note", panel: panel.id, balloon: null, speaker: null, from: null, to: noteMatch[1]!.trim(), source_line: panel.source?.from_line ?? null });
    }
  });

  // Righe sparite: non diventano rimozioni (un taglia-incolla sbagliato non
  // deve cancellare dialoghi), ma chi importa lo deve sapere.
  const missing = [...balloons.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} battute non compaiono nel file (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}): restano com'erano. Per toglierne una, scrivi ${REMOVE_MARK}.`,
    );
  }

  return { corrections, warnings };
}
