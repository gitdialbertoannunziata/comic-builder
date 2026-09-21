/**
 * Rasterizzazione nel browser, via canvas.
 *
 * Non è un doppione di `@comic-builder/export`: quello usa resvg, che è un
 * binario nativo e gira solo in Node. Due host, due motori — ma entrambi
 * partono dallo stesso SVG prodotto dal Core, che resta l'unica descrizione
 * della pagina.
 */

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Incorpora il font dentro l'SVG come data URI.
 *
 * Serve, non è un'ottimizzazione: un SVG caricato dentro un `<img>` viene
 * disegnato in un contesto isolato che **non vede i font del documento**.
 * Senza questo, il PNG esportato uscirebbe con un font di ripiego mentre il
 * lettering è stato calcolato su Comic Neue — lo stesso scarto che aveva già
 * fatto sbordare il testo dai pannelli quando mancava a resvg il file del font.
 */
export function embedFont(svg: string, fontFamily: string, fontBytes: Uint8Array): string {
  const style =
    `<style type="text/css">@font-face{font-family:"${fontFamily}";` +
    `src:url("data:font/ttf;base64,${toBase64(fontBytes)}") format("truetype");}</style>`;

  const insertAt = svg.indexOf(">") + 1;
  return svg.slice(0, insertAt) + `<defs>${style}</defs>` + svg.slice(insertAt);
}

export interface RasterizeOptions {
  widthPx: number;
  background?: string;
}

/** SVG → PNG. La larghezza governa la scala; l'altezza segue il rapporto del viewBox. */
export async function svgToPngBlob(
  svg: string,
  sourceWidth: number,
  sourceHeight: number,
  options: RasterizeOptions,
): Promise<Blob> {
  const scale = options.widthPx / sourceWidth;
  const width = Math.round(options.widthPx);
  const height = Math.round(sourceHeight * scale);

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("L'SVG non è stato caricato come immagine"));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D non disponibile");

    // Una pagina di fumetto è carta: senza fondo esplicito il PNG uscirebbe
    // trasparente, e trasparente su nero è illeggibile.
    context.fillStyle = options.background ?? "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Conversione in PNG fallita"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
