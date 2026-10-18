/**
 * Byte ↔ testo, e l'impronta di un file: servono ai servizi (riferimenti in
 * base64, nomi dati dal contenuto) e alla UI (data URI, sha dell'arte).
 * Stanno qui e non nel Core perché usano `btoa` e WebCrypto dell'host.
 */

/** A blocchi: `String.fromCharCode(...bytes)` su un file intero sfora la pila. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Il formato vero di un'immagine, dai primi byte. L'estensione di un render
 * la decide lo spec, non il motore: ComfyUI salva sempre PNG anche se lo
 * spec chiede JPEG, e un'etichetta sbagliata fa sbagliare chi legge il file.
 */
export function imageMediaType(bytes: Uint8Array, fallback = "image/png"): string {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return fallback;
}

export function dataUri(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${toBase64(bytes)}`;
}

/** SHA-256 in esadecimale, di byte o di testo (UTF-8). */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
