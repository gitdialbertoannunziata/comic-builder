import { useEffect, useState } from "react";
import { parseFont, type LoadedFont } from "@comic-builder/lettering";

interface FontState {
  font: LoadedFont | null;
  error: string | null;
}

/**
 * Carica il font via fetch (non node:fs — questo codice gira nel browser).
 * `parseFont` non sa da dove vengono i byte: stesso pacchetto lettering usato
 * anche da test Node, solo la sorgente dei byte cambia.
 */
export function useFont(url: string): FontState {
  const [state, setState] = useState<FontState>({ font: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Font non trovato (${res.status}): ${url}`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setState({ font: parseFont(buffer), error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ font: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
