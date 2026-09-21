import type { Box } from "../layout/resolveLayout.js";
import type { Margin, OutputTarget, PageTarget, Project } from "../schema/project.js";
import { issue, type ValidationIssue } from "../validate/issue.js";

/**
 * Geometria di un target pagina (§4): da una voce di configurazione alle
 * misure in pixel su cui lavorano layout e renderer.
 *
 * Un target diverso dal canonico **non è un resize** (§4.1 regola 3): le
 * tracce della griglia sono pesi `fr`, quindi si risolvono di nuovo sullo
 * spazio del nuovo target. Una B5 non ha il rapporto di una pagina digitale
 * 2:3, e ogni pannello cambia forma di conseguenza — il documento non si
 * tocca, il lay-out sì. Tutto ciò che è espresso in pixel nel progetto
 * (margini, gutter, corpo del lettering) è in unità della pagina canonica e
 * scala con la larghezza del taglio.
 */
export interface PageTargetGeometry {
  targetId: string;
  /** Canvas completo, bleed compreso. */
  width: number;
  height: number;
  /** Bleed in pixel su ogni lato: il canvas eccede il taglio di tanto. */
  bleed: number;
  /** Il formato finito, dopo il taglio. */
  trim: Box;
  /** Dove stanno i pannelli: il taglio meno margini (o area sicura, se più larga). */
  content: Box;
  /** Pixel del target per pixel della pagina canonica. */
  scale: number;
  /** Moltiplicatore del corpo del lettering: `scale × lettering_scale`. */
  letteringScale: number;
  color: PageTarget["color"];
}

/** Larghezza di riferimento dell'unità di pagina: la larghezza del target canonico. */
export function canonicalPageWidth(project: Pick<Project, "targets">): number {
  const pages = project.targets.filter((t): t is PageTarget => t.kind === "page");
  const primary = pages.find((t) => t.primary) ?? pages[0];
  if (!primary) {
    throw new Error("Il progetto non dichiara nessun target pagina: la pagina è il formato canonico (§4.1).");
  }
  return trimSizePx(primary)[0];
}

function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

/** Dimensione del formato finito in pixel, da `size_px` oppure da `size_mm` + `dpi`. */
export function trimSizePx(target: PageTarget): [number, number] {
  if (target.size_px) return [target.size_px[0], target.size_px[1]];
  if (target.size_mm && target.dpi) {
    return [Math.round(mmToPx(target.size_mm[0], target.dpi)), Math.round(mmToPx(target.size_mm[1], target.dpi))];
  }
  throw new Error(`Il target "${target.id}" non dichiara né size_px né size_mm con dpi.`);
}

export function resolvePageTargetGeometry(
  target: PageTarget,
  project: Pick<Project, "targets" | "page">,
): PageTargetGeometry {
  const [trimWidth, trimHeight] = trimSizePx(target);
  const dpi = target.dpi ?? 0;
  const bleed = dpi > 0 && target.bleed_mm ? Math.round(mmToPx(target.bleed_mm, dpi)) : 0;
  const safe = dpi > 0 && target.safe_mm ? mmToPx(target.safe_mm, dpi) : 0;

  const scale = trimWidth / canonicalPageWidth(project);
  const margin: Margin = {
    top: Math.max(project.page.margin.top * scale, safe),
    right: Math.max(project.page.margin.right * scale, safe),
    bottom: Math.max(project.page.margin.bottom * scale, safe),
    left: Math.max(project.page.margin.left * scale, safe),
  };

  const trim: Box = { x: bleed, y: bleed, width: trimWidth, height: trimHeight };
  return {
    targetId: target.id,
    width: trimWidth + bleed * 2,
    height: trimHeight + bleed * 2,
    bleed,
    trim,
    content: {
      x: trim.x + margin.left,
      y: trim.y + margin.top,
      width: trimWidth - margin.left - margin.right,
      height: trimHeight - margin.top - margin.bottom,
    },
    scale,
    letteringScale: scale * target.lettering_scale,
    color: target.color,
  };
}

export function findTarget(project: Pick<Project, "targets">, id: string): OutputTarget | undefined {
  return project.targets.find((t) => t.id === id);
}

/**
 * Coerenza dei target dichiarati: le sorgenti di regioni e archivi devono
 * esistere ed essere di un tipo che produce immagini, e la stampa deve dire a
 * quale risoluzione. Errori di configurazione che altrimenti si scoprono solo
 * al momento dell'export, cioè quando c'è una scadenza.
 */
export function validateTargets(project: Pick<Project, "targets">): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  for (const target of project.targets) {
    const path = `targets[${target.id}]`;
    if (ids.has(target.id)) issues.push(issue("error", "target.duplicate-id", `Target "${target.id}" dichiarato due volte`, path));
    ids.add(target.id);

    if (target.kind === "page") {
      if (!target.size_px && !(target.size_mm && target.dpi)) {
        issues.push(issue("error", "target.no-size", `"${target.id}": serve size_px oppure size_mm con dpi`, path));
      }
      if ((target.bleed_mm || target.safe_mm) && !target.dpi) {
        issues.push(issue("error", "target.bleed-without-dpi", `"${target.id}": bleed e area sicura in mm richiedono dpi`, path));
      }
      if (target.color === "cmyk") {
        // Onestà: il render è SVG, che vive in RGB. La separazione in quadricromia
        // la fa lo stampatore o un passaggio dedicato, non questo export.
        issues.push(
          issue("warning", "target.cmyk-unsupported", `"${target.id}": l'export esce in RGB; la conversione CMYK va fatta a valle`, path),
        );
      }
    }

    if (target.kind === "strip") {
      const min = target.slice_min_h ?? target.slice_max_h / 2;
      if (min > target.slice_max_h) {
        issues.push(issue("error", "target.slice-range", `"${target.id}": slice_min_h supera slice_max_h`, path));
      }
    }

    if (target.kind === "regions" || target.kind === "archive") {
      const source = project.targets.find((t) => t.id === target.source);
      if (!source) {
        issues.push(issue("error", "target.missing-source", `"${target.id}" deriva da "${target.source}", che non esiste`, path));
      } else if (target.kind === "regions" && source.kind !== "page") {
        issues.push(issue("error", "target.bad-source", `"${target.id}": le regioni derivano da un target pagina`, path));
      } else if (target.kind === "archive" && source.kind !== "page" && source.kind !== "strip") {
        issues.push(issue("error", "target.bad-source", `"${target.id}": un archivio contiene immagini di un target pagina o striscia`, path));
      }
    }
  }

  return issues;
}
