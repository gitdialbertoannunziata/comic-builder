import { describe, expect, it } from "vitest";
import { backends, downloadSize, ENGINES, memoryFor, MODELS, recommend, unsupported, variantKey, type Hardware } from "../src/local/catalog.js";

const mac16: Hardware = { platform: "darwin", arch: "arm64", ramGB: 16, gpu: { name: "Apple Silicon", vendor: "apple", vramGB: null }, glibc: null, freeDiskGB: 200 };
const win12: Hardware = { platform: "win32", arch: "x64", ramGB: 32, gpu: { name: "RTX 4070", vendor: "nvidia", vramGB: 12 }, glibc: null, freeDiskGB: 200 };
const win8: Hardware = { ...win12, gpu: { name: "RTX 3060 Ti", vendor: "nvidia", vramGB: 8 } };
const laptop: Hardware = { platform: "win32", arch: "x64", ramGB: 16, gpu: { name: "Intel Iris Xe", vendor: "intel", vramGB: null }, glibc: null, freeDiskGB: 100 };
const debian: Hardware = { platform: "linux", arch: "x64", ramGB: 32, gpu: { name: "RX 7800", vendor: "amd", vramGB: null }, glibc: "2.36", freeDiskGB: 100 };
const intelMac: Hardware = { platform: "darwin", arch: "x64", ramGB: 16, gpu: null, glibc: null, freeDiskGB: 100 };

describe("Catalogo dei modelli locali", () => {
  it("ogni file ha un checksum SHA-256 e una dimensione: niente si scarica senza verificarlo", () => {
    const files = [...Object.values(ENGINES).flatMap((e) => Object.values(e.variants)), ...MODELS.flatMap((m) => m.files)];
    for (const file of files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(1_000_000);
      expect(file.url).toMatch(/^https:\/\/(github\.com|huggingface\.co)\//);
    }
  });

  it("il modello delle immagini ha i suoi tre pezzi: diffusione, text encoder, VAE", () => {
    for (const option of MODELS.filter((m) => m.kind === "image")) expect(option.files.map((f) => f.role).sort()).toEqual(["diffusion", "text-encoder", "vae"]);
  });

  it("Mac Apple Silicon: Metal, e la memoria è una parte della RAM condivisa", () => {
    expect(backends(mac16)).toEqual(["metal"]);
    expect(memoryFor(mac16, "metal")).toBe(9.6);
    expect(recommend(mac16)).toMatchObject({ backend: "metal", text: "gemma-4-12b", image: "flux2-klein-4b-q4" });
  });

  it("GPU NVIDIA da 12 GB: Vulkan, il modello di testo più grande e [klein] pieno; da 8 GB, versioni più piccole", () => {
    expect(recommend(win12)).toMatchObject({ backend: "vulkan", memoryGB: 12, text: "gemma-4-12b", image: "flux2-klein-4b-q8" });
    expect(recommend(win8)).toMatchObject({ text: "qwen3.5-9b", image: "flux2-klein-4b-q4" });
  });

  it("portatile con grafica integrata: lo spoglio si fa piccolo, le immagini si sconsigliano", () => {
    const r = recommend(laptop);
    expect(r.backend).toBe("vulkan");
    expect(r.text).toBe("qwen3.5-4b");
    expect(r.image).toBeNull();
    expect(r.notes.join(" ")).toContain("servizio cloud");
  });

  it("Linux con una glibc vecchia: lo spoglio sì, le immagini no, e si dice perché", () => {
    expect(unsupported("text", debian, "vulkan")).toBeNull();
    expect(unsupported("image", debian, "vulkan")).toContain("glibc 2.38");
    expect(recommend(debian)).toMatchObject({ image: null });
    expect(unsupported("image", { ...debian, glibc: "2.39" }, "vulkan")).toBeNull();
  });

  it("Mac Intel: niente motore delle immagini", () => {
    expect(recommend(intelMac)).toMatchObject({ backend: "cpu", image: null });
    expect(unsupported("image", intelMac, "cpu")).toContain("Intel");
  });

  it("la dimensione del download conta motori e file, una volta sola", () => {
    const size = downloadSize(win12, "vulkan", { text: "qwen3.5-4b", image: "flux2-klein-4b-q4" });
    const expected =
      ENGINES.text.variants[variantKey(win12, "vulkan")]!.size +
      ENGINES.image.variants[variantKey(win12, "vulkan")]!.size +
      MODELS.find((m) => m.id === "qwen3.5-4b")!.files.reduce((n, f) => n + f.size, 0) +
      MODELS.find((m) => m.id === "flux2-klein-4b-q4")!.files.reduce((n, f) => n + f.size, 0);
    expect(size).toBe(expected);
    expect(downloadSize(win12, "vulkan", { text: null, image: null })).toBe(0);
  });
});
