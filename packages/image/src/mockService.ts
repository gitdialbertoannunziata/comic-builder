import type { ImageEstimate, ImageRequest, ImageResult, ImageService } from "./service.js";

/** PNG 1×1 grigio: un'immagine vera, così chi la riceve la tratta come tale. */
const PIXEL = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mM8Vw8AAkEBX6r1j+4AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

/**
 * Servizio finto (§11.4: nessuna rete nei test). Registra le richieste e
 * può fallire a comando, per provare coda, retry e annullamento.
 */
export class MockImageService implements ImageService {
  readonly name = "mock";
  readonly model = "mock-image";
  readonly maxReferences = 8;
  readonly requests: ImageRequest[] = [];
  /** Chiamata prima di ogni risposta: lanciare qui simula un errore del fornitore. */
  before: (request: ImageRequest, attempt: number) => void | Promise<void> = () => {};
  private readonly attempts = new Map<string, number>();

  estimate(): ImageEstimate {
    return { usd: 0, seconds: 0 };
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    this.requests.push(request);
    const attempt = (this.attempts.get(request.spec.panel) ?? 0) + 1;
    this.attempts.set(request.spec.panel, attempt);
    await this.before(request, attempt);
    return { data: PIXEL, mediaType: "image/png", meta: { model: this.model, durationMs: 0, costUsd: 0 } };
  }
}
