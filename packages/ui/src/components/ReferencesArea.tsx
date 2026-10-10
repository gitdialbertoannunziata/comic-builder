import { t } from "../i18n.js";
import type { Command, ProjectDoc, ProjectStore } from "@comic-builder/core";
import type { BreakdownPlace, PlaceToDescribe } from "@comic-builder/llm";
import type { ImageConfig } from "./GenerateCard.js";
import { CharactersPanel } from "./CharactersPanel.js";
import { LocationsPanel } from "./LocationsPanel.js";
import { StylePanel } from "./StylePanel.js";
import { Tabs } from "./Tabs.js";

export type ReferencesTab = "stile" | "personaggi" | "luoghi";

interface Props {
  doc: ProjectDoc;
  store: ProjectStore;
  image: ImageConfig;
  run: (command: Command, options?: { gesture?: string }) => boolean;
  endGesture: () => void;
  tab: ReferencesTab;
  onTab: (tab: ReferencesTab) => void;
  /** Il personaggio o il luogo da aprire, quando ci si arriva da una vignetta. */
  focus: { ref: string; at: number } | null;
  describe: (places: readonly PlaceToDescribe[]) => Promise<BreakdownPlace[]>;
  describer: string;
  describeService: string;
}

const LEAD: Record<ReferencesTab, string> = {
  stile: "Uno per tutta l'opera: va in testa a ogni immagine, uguale, e le sue tavole si allegano a ogni generazione.",
  personaggi: "Sono dell'opera, non del capitolo: com'è fatto ognuno si dice qui una volta, e vale in ogni vignetta.",
  luoghi: "Le scene dicono dove siamo; qui si dice com'è fatto il posto, perché sia lo stesso posto in ogni vignetta.",
};

/**
 * I riferimenti dell'opera: ciò che tiene insieme un capitolo generato. Lo
 * stile fa sì che le vignette siano disegnate dalla stessa mano, i luoghi
 * che la stanza resti la stessa stanza, i personaggi che la faccia resti la
 * stessa faccia. Valgono per tutta la serie, non per un capitolo.
 */
export function ReferencesArea({ doc, store, image, run, endGesture, tab, onTab, focus, describe, describer, describeService }: Props) {
  return (
    <>
      <header className="area__head">
        <h2 className="area__title">{t("Riferimenti")}</h2>
        <p className="area__lead">{t(LEAD[tab])}</p>
      </header>
      <Tabs<ReferencesTab>
        label={t("Riferimenti dell'opera")}
        className="tabs--references"
        value={tab}
        onChange={onTab}
        items={[
          { id: "stile", label: t("Stile"), title: t("Come è disegnata l'opera: il testo e le tavole di stile") },
          { id: "personaggi", label: t("Personaggi"), badge: Object.keys(doc.characters).length, title: t("Le schede dei personaggi") },
          { id: "luoghi", label: t("Luoghi"), title: t("Le schede dei luoghi: com'è fatto ogni posto in cui si svolge una scena") },
        ]}
      />
      <div role="tabpanel" hidden={tab !== "stile"}>
        <StylePanel doc={doc} store={store} run={run} />
      </div>
      <div role="tabpanel" hidden={tab !== "personaggi"}>
        <CharactersPanel doc={doc} store={store} image={image} run={run} endGesture={endGesture} focus={tab === "personaggi" ? focus : null} />
      </div>
      <div role="tabpanel" hidden={tab !== "luoghi"}>
        <LocationsPanel doc={doc} store={store} image={image} run={run} endGesture={endGesture} describe={describe} describer={describer} describeService={describeService} focus={tab === "luoghi" ? focus : null} />
      </div>
    </>
  );
}
