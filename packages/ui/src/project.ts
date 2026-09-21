import {
  BalloonStyleSchema,
  DraftStyleSchema,
  LetteringConfigSchema,
  resolvePageTargetGeometry,
  type PageTarget,
  type TargetStyles,
} from "@comic-builder/core";
import { sampleProject } from "@comic-builder/core/fixtures";

/**
 * Il progetto su cui lavora l'Ispettore. Finché non sa aprire una cartella di
 * progetto (F2), è quello d'esempio: target, lettering e stili vengono da qui
 * e non da costanti sparse, così l'anteprima e l'export leggono la stessa
 * configurazione che leggerebbero da un project.json vero.
 */
export const project = sampleProject;

export const styles: TargetStyles = {
  lettering: LetteringConfigSchema.parse(project.lettering),
  balloonStyle: BalloonStyleSchema.parse(project.balloon_style),
  draftStyle: DraftStyleSchema.parse(project.draft_style),
};

export const primaryTarget: PageTarget = (() => {
  const pages = project.targets.filter((t): t is PageTarget => t.kind === "page");
  const primary = pages.find((t) => t.primary) ?? pages[0];
  if (!primary) throw new Error("Il progetto non dichiara un target pagina.");
  return primary;
})();

/** Geometria del target canonico: è quella su cui si autora e si guarda l'anteprima (§4.1). */
export const primaryGeometry = resolvePageTargetGeometry(primaryTarget, project);
