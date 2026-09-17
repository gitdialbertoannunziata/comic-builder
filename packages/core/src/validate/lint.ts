import type { Page } from "../schema/page.js";
import type { Panel } from "../schema/panel.js";
import type { Scene } from "../schema/scenes.js";
import { issue, type ValidationIssue } from "./issue.js";

/**
 * Lint di continuità e di ritmo (§6.3, §6.4, Appendice A).
 *
 * Distinto da `validateDocument`: quello dice se il documento è *coerente*
 * (se non lo è, gli algoritmi a valle si rompono); questo dice se è *buono*,
 * con i livelli dichiarati dall'Appendice A. Entrambi deterministici, entrambi
 * senza GPU — "un linter deterministico è economico [...] e per un autore
 * seriale è un controllo di qualità che nessuno strumento consumer offre".
 */

export interface LintOptions {
  /** La scena a cui la pagina appartiene: abilita le regole di contenuto che senza non sono calcolabili. */
  scene?: Scene;
  /** Target per cui valutare le regole di produzione (arte mancante, render stale). */
  target?: string;
}

/** Soglia indicativa dell'Appendice A per il testo di un balloon. */
const MAX_BALLOON_CHARS = 220;

function panelsInReadingOrder(page: Page): Panel[] {
  const byId = new Map(page.panels.map((p) => [p.id, p]));
  const order = page.layout.mode === "page" ? page.layout.reading_order : page.layout.sequence;
  const ordered = order.map((id) => byId.get(id)).filter((p): p is Panel => p !== undefined);
  // Se l'ordine è incompleto lo dice validateDocument: qui si lavora su ciò che c'è.
  return ordered.length === page.panels.length ? ordered : page.panels;
}

function balloonText(panel: Panel, index: number): string {
  return panel.balloons[index]!.text.map((run) => run.t).join("");
}

function lintCameraRhythm(page: Page): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const panels = panelsInReadingOrder(page);

  // Appendice A descrive lo stesso vincolo da due angolazioni ("tre o più
  // consecutivi con lo stesso shot" e "nessun cambio di shot entro due
  // pannelli"): è una regola sola — al massimo due pannelli di fila con la
  // stessa inquadratura — e segnalarla due volte farebbe solo rumore.
  let runStart = 0;
  for (let i = 1; i <= panels.length; i++) {
    const sameAsPrevious = i < panels.length && panels[i]!.camera.shot === panels[runStart]!.camera.shot;
    if (sameAsPrevious) continue;

    const runLength = i - runStart;
    if (runLength >= 3) {
      const ids = panels.slice(runStart, i).map((p) => p.id).join(", ");
      issues.push(
        issue(
          "warning",
          "camera.repeated-shot",
          `${runLength} pannelli consecutivi con lo stesso shot (${panels[runStart]!.camera.shot}): ${ids}`,
          "panels",
        ),
      );
    }
    runStart = i;
  }

  // Pagina senza alcun respiro: tutta di primi piani.
  const hasWideOrInsert = panels.some((p) => ["LS", "MLS", "EWS", "INSERT"].includes(p.camera.shot));
  if (panels.length > 0 && !hasWideOrInsert) {
    issues.push(
      issue(
        "info",
        "camera.no-wide-shot",
        "La pagina non ha nessun LS, MLS o INSERT: rischia di essere tutta primi piani",
        "panels",
      ),
    );
  }

  // Jump cut: stessa inquadratura, stesso angolo, stesso luogo, uno dopo l'altro.
  // `axis_side` diverso lo esclude: due pannelli che condividono shot e angolo
  // ma sono ripresi dai due lati opposti dell'asse sono un campo/controcampo,
  // cioè la copertura normale di un dialogo — non uno stacco sbagliato. Senza
  // questa condizione il lint segnalerebbe come errore proprio ciò che la
  // tabella beat→camera di §6.2 prescrive per il dialogo.
  for (let i = 1; i < panels.length; i++) {
    const previous = panels[i - 1]!;
    const current = panels[i]!;
    if (
      previous.camera.shot === current.camera.shot &&
      previous.camera.angle === current.camera.angle &&
      previous.camera.axis_side === current.camera.axis_side &&
      previous.setting === current.setting
    ) {
      issues.push(
        issue(
          "warning",
          "camera.jump-cut",
          `Jump cut fra "${previous.id}" e "${current.id}": stesso shot, stesso angolo, stesso setting`,
          `panels[${current.id}].camera`,
        ),
      );
    }
  }

  const dutchCount = panels.filter((p) => p.camera.angle === "dutch").length;
  if (dutchCount > 2) {
    issues.push(
      issue("info", "camera.dutch-overuse", `Angolo dutch usato ${dutchCount} volte nella stessa pagina`, "panels"),
    );
  }

  return issues;
}

/**
 * Regola dei 180° (§6.4): in uno scambio botta-e-risposta i due interlocutori
 * vanno ripresi da lati opposti dell'asse. Due pannelli consecutivi che fanno
 * parlare persone diverse ma condividono `axis_side` scavalcano l'asse, e in
 * lettura sembra che i due si diano le spalle.
 */
function lintAxisContinuity(page: Page): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const panels = panelsInReadingOrder(page);

  const speakerOf = (panel: Panel): string | null => {
    const speaking = panel.balloons.find((b) => b.speaker.ref !== null);
    return speaking ? speaking.speaker.ref : null;
  };

  for (let i = 1; i < panels.length; i++) {
    const previous = panels[i - 1]!;
    const current = panels[i]!;
    const previousSpeaker = speakerOf(previous);
    const currentSpeaker = speakerOf(current);

    if (!previousSpeaker || !currentSpeaker || previousSpeaker === currentSpeaker) continue;
    if (previous.camera.axis_side === current.camera.axis_side) {
      issues.push(
        issue(
          "warning",
          "camera.axis-break",
          `Scambio fra "${previousSpeaker}" e "${currentSpeaker}" ripreso dallo stesso lato dell'asse (${current.camera.axis_side}): regola dei 180°`,
          `panels[${current.id}].camera.axis_side`,
        ),
      );
    }
  }

  return issues;
}

function lintBalloons(page: Page): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const panel of page.panels) {
    const knownRefs = new Set(panel.characters.map((c) => c.ref));

    if (panel.balloons.length > 3) {
      issues.push(
        issue(
          "info",
          "balloon.crowded-panel",
          `${panel.balloons.length} balloon nello stesso pannello "${panel.id}"`,
          `panels[${panel.id}].balloons`,
        ),
      );
    }

    panel.balloons.forEach((balloon, index) => {
      const path = `panels[${panel.id}].balloons[${balloon.id}]`;

      const { x, y } = balloon.anchor;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        issues.push(
          issue("error", "balloon.anchor-out-of-range", `Ancora fuori da [0,1]: (${x}, ${y})`, `${path}.anchor`),
        );
      }

      // Uno speaker che non compare fra i personaggi del pannello è un errore,
      // a meno che il balloon sia dichiarato fuori campo: è ciò che `offpanel`
      // esiste per esprimere (§8.2).
      if (balloon.type !== "offpanel" && balloon.speaker.ref !== null && !knownRefs.has(balloon.speaker.ref)) {
        issues.push(
          issue(
            "error",
            "balloon.unknown-speaker",
            `Lo speaker "${balloon.speaker.ref}" non compare fra i personaggi del pannello: marcalo come offpanel o aggiungilo al pannello`,
            `${path}.speaker`,
          ),
        );
      }

      const text = balloonText(panel, index);
      if (text.length > MAX_BALLOON_CHARS) {
        issues.push(
          issue(
            "warning",
            "balloon.text-too-long",
            `Testo di ${text.length} caratteri, oltre la soglia utile di ${MAX_BALLOON_CHARS}`,
            `${path}.text`,
          ),
        );
      }
    });
  }

  return issues;
}

function lintGridRhythm(page: Page): ValidationIssue[] {
  const count = page.panels.length;
  if (page.layout.mode !== "page") return [];
  if (count >= 3 && count <= 6) return [];

  return [
    issue(
      "info",
      "grid.panel-count",
      `${count} pannelli in pagina: fuori dall'intervallo consigliato di 3–6`,
      "panels",
    ),
  ];
}

function lintProduction(page: Page, target: string): ValidationIssue[] {
  const missing = page.panels.filter((p) => p.art.source === null && !p.render[target]);
  if (missing.length === 0) return [];

  return [
    issue(
      "info",
      "production.missing-art",
      `${missing.length} pannelli senza arte né render per "${target}": ${missing.map((p) => p.id).join(", ")}`,
      "panels",
    ),
  ];
}

function lintSceneCoverage(page: Page, scene: Scene): ValidationIssue[] {
  const appearing = new Set(page.panels.flatMap((p) => p.characters.map((c) => c.ref)));
  const absent = scene.characters.filter((ref) => !appearing.has(ref));
  if (absent.length === 0) return [];

  return [
    issue(
      "info",
      "content.absent-character",
      `Personaggi della scena assenti da questa pagina: ${absent.join(", ")}`,
      "panels",
    ),
  ];
}

/**
 * Applica le regole dell'Appendice A calcolabili da una pagina (più la scena,
 * se disponibile). Restano fuori, per ora, le regole che richiedono contesto
 * che il documento non porta ancora: la coda che attraversa il testo (serve la
 * geometria del render), `balloon.rev` rispetto al changelog e lo stato di
 * staleness dei render (arrivano con F2.2 e con il ramo AI).
 */
export function lintPage(page: Page, options: LintOptions = {}): ValidationIssue[] {
  const issues = [
    ...lintGridRhythm(page),
    ...lintCameraRhythm(page),
    ...lintAxisContinuity(page),
    ...lintBalloons(page),
    ...lintProduction(page, options.target ?? "digital-page"),
  ];

  if (options.scene) issues.push(...lintSceneCoverage(page, options.scene));

  return issues;
}
