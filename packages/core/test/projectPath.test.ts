import { describe, expect, it } from "vitest";
import { isProjectPath, ReferenceImageSchema } from "../src/index.js";

describe("Percorsi dentro il progetto", () => {
  it("relativi, con /, senza . né ..", () => {
    for (const ok of ["characters/sara/a.png", "art/p01.psd", "fonts/OpenComicSans.woff2", "a..b/c.png"]) expect(isProjectPath(ok), ok).toBe(true);
    for (const bad of ["", "/etc/passwd", "../fuori.png", "characters/../../x", "a//b", "./a.png", "C:/Windows/x", "c:x", "a\\..\\b"]) expect(isProjectPath(bad), bad).toBe(false);
  });

  it("un progetto con un riferimento che esce dalla cartella non si carica", () => {
    expect(ReferenceImageSchema.safeParse({ path: "../../.ssh/id_rsa" }).success).toBe(false);
    expect(ReferenceImageSchema.safeParse({ path: "characters/sara/a.png" }).success).toBe(true);
  });
});
