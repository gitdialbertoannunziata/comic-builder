import { buildPagesFromScene, type Page, type Scene, type ValidationIssue } from "@comic-builder/core";
import { MockLlmService, OllamaLlmService, breakdownScript, type LlmService } from "@comic-builder/llm";
import { TARGET } from "./renderPreview.js";
import type { ServiceChoice, BreakdownSummary } from "./components/ScriptPanel.js";

export interface RunBreakdownInput {
  script: string;
  service: ServiceChoice;
  ollamaModel: string;
  chapterId: string;
}

export interface RunBreakdownResult {
  pages: Page[];
  scenes: Scene[];
  summary: BreakdownSummary;
}

function serviceFor(choice: ServiceChoice, model: string): LlmService {
  if (choice === "ollama") return new OllamaLlmService({ model });
  return new MockLlmService();
}

/**
 * Catena completa di F1 lanciata dalla UI: capitolo → scene → pagine.
 * Le pagine si numerano di seguito attraverso le scene, perché è il capitolo
 * a essere impaginato, non la singola scena (§5.3: serie → episodio → pagina).
 */
export async function runBreakdown(input: RunBreakdownInput): Promise<RunBreakdownResult> {
  const result = await breakdownScript({
    llm: serviceFor(input.service, input.ollamaModel),
    script: input.script,
    scriptFile: "copione-incollato.md",
  });

  const pages: Page[] = [];
  const issues: ValidationIssue[] = [...result.issues];
  let pageNumber = 1;

  for (const scene of result.scenes) {
    const scenePages = buildPagesFromScene({
      chapterId: input.chapterId,
      scene,
      firstPageNumber: pageNumber,
      primaryTarget: TARGET,
      gutter: { x: 14, y: 18 },
      readingDirection: "ltr",
    });
    pageNumber += scenePages.length;
    pages.push(...scenePages);
  }

  return {
    pages,
    scenes: result.scenes,
    summary: {
      scenes: result.scenes.length,
      beats: result.scenes.reduce((sum, s) => sum + s.beats.length, 0),
      pages: pages.length,
      service: result.meta.service,
      model: result.meta.model,
      durationMs: result.meta.durationMs,
      issues,
    },
  };
}
