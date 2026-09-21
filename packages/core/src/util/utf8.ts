/**
 * UTF-8 senza `TextEncoder`/`TextDecoder`: il Core compila senza le librerie
 * DOM né i tipi di Node (§11.2), e questa è l'unica codifica che gli serve.
 */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

export function fromUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 31) << 6) | (bytes[i + 1]! & 63);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63);
      i += 3;
    } else {
      code = ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}
