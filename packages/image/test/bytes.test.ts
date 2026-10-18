import { describe, expect, it } from "vitest";
import { dataUri, fromBase64, imageMediaType, sha256Hex, toBase64 } from "../src/bytes.js";

describe("Byte, base64 e impronte", () => {
  it("base64 andata e ritorno, anche oltre un blocco", () => {
    const big = Uint8Array.from({ length: 0x8000 * 2 + 7 }, (_, i) => i % 251);
    expect([...fromBase64(toBase64(big))]).toEqual([...big]);
    expect(dataUri(new Uint8Array([1, 2, 3]), "image/png")).toBe("data:image/png;base64,AQID");
  });

  it("SHA-256 di byte e di testo", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
  });

  it("il formato vero viene dai primi byte, non dall'estensione", () => {
    expect(imageMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(imageMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageMediaType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(imageMediaType(new Uint8Array([1, 2]), "image/jpeg")).toBe("image/jpeg");
  });
});
