import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectDoc, ProjectStore } from "@comic-builder/core";
import { primaryTarget } from "../project.js";
import type { ArtWatcher } from "./useArtWatcher.js";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Pannello → file del render che lo riempie: solo dove l'autore non ha messo arte sua, che vince sempre. */
function renderFiles(doc: ProjectDoc): Map<string, string> {
  const files = new Map<string, string>();
  for (const page of Object.values(doc.pages)) {
    for (const panel of page.panels) {
      const file = panel.art.source ? undefined : panel.render[primaryTarget.id]?.file;
      if (file) files.set(panel.id, file);
    }
  }
  return files;
}

/**
 * I render (§5.7) accanto all'arte dell'autore: stessa forma di
 * `useArtWatcher`, così anteprima, striscia ed export li trovano senza
 * sapere da dove viene l'immagine. Non c'è cartella da sorvegliare: un
 * render ha il nome del suo contenuto, e una volta letto non cambia più.
 */
export function useRenders(store: ProjectStore, doc: ProjectDoc, art: ArtWatcher): ArtWatcher {
  const cache = useRef(new Map<string, string>());
  const [version, setVersion] = useState(0);
  const files = useMemo(() => renderFiles(doc), [doc]);
  const wanted = useMemo(() => [...new Set(files.values())].sort().join("\n"), [files]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const paths = new Set(wanted ? wanted.split("\n") : []);
      let changed = false;
      for (const [path, url] of cache.current) {
        if (paths.has(path)) continue;
        URL.revokeObjectURL(url);
        cache.current.delete(path);
        changed = true;
      }
      for (const path of paths) {
        if (cache.current.has(path)) continue;
        const bytes = await store.readBytes(path);
        if (!alive) return;
        if (!bytes) continue;
        cache.current.set(path, URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" })));
        changed = true;
      }
      if (changed) setVersion((v) => v + 1);
    })();
    return () => {
      alive = false;
    };
  }, [store, wanted]);

  // Cambiando cartella i percorsi restano gli stessi ma i byte no: si riparte.
  useEffect(() => {
    const current = cache.current;
    return () => {
      for (const url of current.values()) URL.revokeObjectURL(url);
      current.clear();
    };
  }, [store]);

  const urls = useMemo(() => {
    const map = new Map(art.urls);
    for (const [panelId, file] of files) {
      const url = cache.current.get(file);
      if (url) map.set(panelId, url);
    }
    return map;
    // `version` cambia quando un render è stato letto: è il segnale per ricalcolare.
  }, [art.urls, files, version]);

  const artDataUris = art.dataUris;
  const dataUris = useCallback(
    async (target: ProjectDoc) => {
      const out = await artDataUris(target);
      for (const [panelId, file] of renderFiles(target)) {
        const bytes = await store.readBytes(file);
        if (bytes) out.set(panelId, `data:image/png;base64,${base64(bytes)}`);
      }
      return out;
    },
    [store, artDataUris],
  );

  return { urls, scan: art.scan, dataUris };
}
