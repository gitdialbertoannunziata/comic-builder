import { buildPagesFromScene, type Page, type Scene, type ValidationIssue } from "@comic-builder/core";
import {
  MockLlmService,
  OllamaLlmService,
  AnthropicLlmService,
  DeepSeekLlmService,
  OpenAiLlmService,
  breakdownScript,
  type BreakdownCastMember,
  type BreakdownPlace,
  type LlmService,
} from "@comic-builder/llm";
import { TARGET } from "./renderPreview.js";
import type { ServiceChoice, BreakdownSummary } from "./components/ScriptPanel.js";
import type { ChapterContext } from "@comic-builder/core";
import { networkFetch } from "./platform/desktop.js";

/** Il modello linguistico scelto nel Copione, con ciò che serve a chiamarlo. */
export interface LlmChoice {
  service: ServiceChoice;
  ollamaModel: string;
  ollamaHost: string;
  anthropicKey: string;
  anthropicModel: string;
  deepseekKey: string;
  deepseekModel: string;
  openaiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
}

export interface RunBreakdownInput extends LlmChoice {
  script: string;
  /** Avanzamento dello spoglio a parti: un capitolo lungo richiede più richieste. */
  onProgress?: (progress: { done: number; total: number }) => void;
  chapterId: string;
  /** Ciò che si sa dell'opera: personaggi con scheda, luoghi già visti, regole della serie, riassunto del precedente. */
  context?: ChapterContext;
}

export interface RunBreakdownResult {
  pages: Page[];
  scenes: Scene[];
  /** Chi compare nel capitolo, con ciò che il testo ne dice: le schede di chi non ne ha una nascono da qui. */
  cast: BreakdownCastMember[];
  /** I luoghi delle scene, con la descrizione proposta: le schede dei luoghi nascono da qui. */
  locations: BreakdownPlace[];
  summary: BreakdownSummary;
}

export function llmServiceFor(input: LlmChoice): LlmService {
  const choice = input.service;
  // Nell'app desktop le chiamate passano dal processo principale (`networkFetch`): niente CORS.
  if (choice === "ollama") return new OllamaLlmService({ model: input.ollamaModel, host: input.ollamaHost, ...networkFetch });
  if (choice === "anthropic") {
    return new AnthropicLlmService({
      apiKey: input.anthropicKey,
      model: input.anthropicModel,
      // La chiave vive nel browser: è una scelta consapevole per uno strumento
      // locale a utente singolo, e l'interfaccia lo dice. Con il packaging
      // desktop (§14.4) passerà all'archivio sicuro dell'host.
      allowBrowser: true,
      ...networkFetch,
    });
  }
  if (choice === "deepseek") {
    return new DeepSeekLlmService({ apiKey: input.deepseekKey, model: input.deepseekModel, ...networkFetch });
  }
  if (choice === "openai") {
    return new OpenAiLlmService({ apiKey: input.openaiKey, model: input.openaiModel, baseUrl: input.openaiBaseUrl, ...networkFetch });
  }
  return new MockLlmService();
}

/**
 * Catena completa di F1 lanciata dalla UI: capitolo → scene → pagine.
 * Le pagine si numerano di seguito attraverso le scene, perché è il capitolo
 * a essere impaginato, non la singola scena (§5.3: serie → episodio → pagina).
 */
export async function runBreakdown(input: RunBreakdownInput): Promise<RunBreakdownResult> {
  const result = await breakdownScript({
    llm: llmServiceFor(input),
    script: input.script,
    // Stesso percorso in cui il copione si salva (script/<capitolo>.md): la
    // provenienza dei pannelli punta al file giusto per le revisioni (§10.1).
    scriptFile: `script/${input.chapterId}.md`,
    // Id di scena per capitolo: lo spoglio del capitolo 2 non riusa gli id del capitolo 1.
    scenePrefix: `${input.chapterId}-s`,
    ...(input.context ? { context: input.context } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
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
    cast: result.cast,
    locations: result.locations,
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
