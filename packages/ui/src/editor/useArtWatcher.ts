import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ART_DIR, artCommands, artMediaType, isArtFile, type ArtFile, type Command, type ProjectDoc, type ProjectStore } from "@comic-builder/core";

/**
 * Sorveglia `art/` e tiene il documento allineato a ciò che l'autore
 * esporta da fuori (criterio d'uscita di F2).
 *
 * La File System Access API non notifica le modifiche (l'osservatore dei
 * file è ancora sperimentale), quindi si interroga la cartella ogni due
 * secondi. Costa poco: si legge solo l'elenco con data e dimensione, e si
 * rilegge un file — per l'impronta SHA-256 e l'immagine — solo quando una
 * delle due cambia. Con la scheda in background la sorveglianza si ferma.
 */
const POLL_MS = 2000;

interface Seen {
  lastModified: number;
  size: number;
  sha: string;
  url: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ArtWatcher {
  /** Pannello → URL dell'immagine, per l'anteprima. */
  urls: ReadonlyMap<string, string>;
  /** Controlla subito, senza aspettare il prossimo giro (dopo un import esplicito). */
  scan: () => Promise<void>;
  /** Pannello → data URI, per l'export: un SVG dentro un'immagine non può caricare blob esterni. */
  dataUris: (doc: ProjectDoc) => Promise<Map<string, string>>;
}

export function useArtWatcher(
  store: ProjectStore | null,
  doc: ProjectDoc,
  run: (command: Command, options?: { gesture?: string }) => boolean,
  endGesture: () => void,
): ArtWatcher {
  const seen = useRef(new Map<string, Seen>());
  const [version, setVersion] = useState(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  const busy = useRef(false);
  const sync = useRef(0);

  const scan = useCallback(async () => {
    if (!store || busy.current) return;
    busy.current = true;
    try {
      const entries = (await store.list(ART_DIR)).filter((e) => e.kind === "file" && isArtFile(e.name));
      let changed = false;
      const present = new Set<string>();
      for (const entry of entries) {
        const path = `${ART_DIR}/${entry.name}`;
        present.add(path);
        const previous = seen.current.get(path);
        if (previous && previous.lastModified === entry.lastModified && previous.size === entry.size) continue;
        const bytes = await store.readBytes(path);
        if (!bytes) continue;
        if (previous) URL.revokeObjectURL(previous.url);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: artMediaType(path) ?? "application/octet-stream" }));
        seen.current.set(path, { lastModified: entry.lastModified ?? 0, size: entry.size ?? bytes.length, sha: await sha256(bytes), url });
        changed = true;
      }
      for (const [path, info] of seen.current) {
        if (present.has(path)) continue;
        URL.revokeObjectURL(info.url);
        seen.current.delete(path);
        changed = true;
      }
      if (!changed) return;
      setVersion((v) => v + 1);

      // Tutti i collegamenti di un giro sono un solo passo di undo.
      const files: ArtFile[] = [...seen.current].map(([path, info]) => ({ path, sha: info.sha }));
      const commands = artCommands(docRef.current, files);
      if (commands.length > 0) {
        const gesture = `art-sync-${++sync.current}`;
        for (const command of commands) run(command, { gesture });
        endGesture();
      }
    } finally {
      busy.current = false;
    }
  }, [store, run, endGesture]);

  useEffect(() => {
    const cache = seen.current;
    if (!store) return;
    void scan();
    const timer = setInterval(() => {
      if (!document.hidden) void scan();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      for (const info of cache.values()) URL.revokeObjectURL(info.url);
      cache.clear();
    };
  }, [store, scan]);

  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of Object.values(doc.pages)) {
      for (const panel of page.panels) {
        const info = panel.art.source ? seen.current.get(panel.art.source) : undefined;
        if (info) map.set(panel.id, info.url);
      }
    }
    return map;
    // `version` cambia quando cambia la cartella: è il segnale per ricalcolare.
  }, [doc, version]);

  const dataUris = useCallback(
    async (target: ProjectDoc) => {
      const out = new Map<string, string>();
      if (!store) return out;
      for (const page of Object.values(target.pages)) {
        for (const panel of page.panels) {
          if (!panel.art.source) continue;
          const bytes = await store.readBytes(panel.art.source);
          if (!bytes) continue;
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          out.set(panel.id, `data:${artMediaType(panel.art.source) ?? "image/png"};base64,${btoa(binary)}`);
        }
      }
      return out;
    },
    [store],
  );

  return { urls, scan, dataUris };
}
