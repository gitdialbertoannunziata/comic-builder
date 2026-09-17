interface Props {
  svg: string | null;
}

/** Render live: stessa stringa SVG che produce renderPageSvg per l'export, qui iniettata nel DOM. */
export function SvgPreview({ svg }: Props) {
  if (!svg) {
    return <p style={{ color: "#888", fontSize: 13 }}>Nessuna anteprima (layout non in modalità "page").</p>;
  }

  return (
    <div
      style={{ maxWidth: 560, border: "1px solid #ddd", borderRadius: 6, background: "white" }}
      // L'SVG viene da renderPageSvg (Core), non da input utente: nessun contenuto arbitrario.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
