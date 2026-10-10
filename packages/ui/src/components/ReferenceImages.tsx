import { t } from "../i18n.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isArtFile, type ProjectStore, type ReferenceImage } from "@comic-builder/core";

/** Anteprime delle immagini di riferimento, lette dalla cartella del progetto. */
export function useReferenceUrls(store: ProjectStore, paths: readonly string[]): Map<string, string> {
  const [urls, setUrls] = useState(new Map<string, string>());
  const key = paths.join("\n");
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void (async () => {
      const map = new Map<string, string>();
      for (const path of paths) {
        const bytes = await store.readBytes(path);
        if (!bytes) continue;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
        created.push(url);
        map.set(path, url);
      }
      if (alive) setUrls(map);
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // `key` riassume `paths`: cambia solo quando cambiano i percorsi.
  }, [store, key]);
  return urls;
}

interface Props {
  store: ProjectStore;
  references: readonly ReferenceImage[];
  onChange: (references: ReferenceImage[]) => void;
  /** Cartella del progetto in cui vanno le immagini caricate: `style`, `locations/la_stanza`… */
  directory: string;
  /** Perché spuntare un'immagine, per il `title` della casella: cambia per stile, luogo, personaggio. */
  useHint: string;
  /** Altri bottoni accanto a «+ immagine…»: generare, proporre. */
  children?: ReactNode;
}

/**
 * Le immagini di riferimento di una scheda: anteprima, «per generare» (la
 * curatela: si allegano solo quelle spuntate), togli, carica. Le stesse per
 * lo stile dell'opera, per un luogo e per un personaggio — il modello le
 * riceve allo stesso modo, e l'autore le cura allo stesso modo.
 */
export function ReferenceImages({ store, references, onChange, directory, useHint, children }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useReferenceUrls(store, references.map((r) => r.path));

  async function add(files: readonly File[]) {
    const added: ReferenceImage[] = [];
    for (const file of files) {
      if (!isArtFile(file.name)) continue;
      const path = `${directory}/${file.name.replace(/[^\w.-]+/g, "_")}`;
      await store.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
      if (!references.some((r) => r.path === path)) added.push({ path, note: "", use: true });
    }
    if (added.length > 0) onChange([...references, ...added]);
  }

  return (
    <>
      {references.length > 0 && (
        <div className="reference-grid">
          {references.map((r) => (
            <figure key={r.path} className={`reference${r.use ? "" : " reference--unused"}`}>
              {urls.get(r.path) ? <img src={urls.get(r.path)} alt={r.note || r.path} /> : <span className="art-thumb art-thumb--missing">?</span>}
              <figcaption>
                {r.note || r.path.split("/").pop()}{" "}
                <label title={useHint}>
                  <input type="checkbox" checked={r.use} onChange={(e) => onChange(references.map((x) => (x.path === r.path ? { ...x, use: e.target.checked } : x)))} /> {" "}{t("per generare")}</label>{" "}
                <button type="button" className="link-btn" onClick={() => onChange(references.filter((x) => x.path !== r.path))}>
                  {t("togli")}</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="tool-row">
        <button type="button" className="btn btn--small" onClick={() => input.current?.click()}>
          {t("+ immagine…")}</button>
        {children}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void add(files);
        }}
      />
    </>
  );
}
