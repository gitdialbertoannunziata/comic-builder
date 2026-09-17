import { buildPagesFromScene, type Page } from "@comic-builder/core";
import { sampleScene } from "@comic-builder/core/fixtures";
import { TARGET } from "./renderPreview.js";

/**
 * Documento di partenza dell'Ispettore: le pagine che lo spoglio produce dalla
 * scena di esempio, passando per la stessa catena di F1 (beat → camera dalla
 * tabella di §6.2, template dal catalogo, id stabili). Non un documento
 * scritto a mano per la demo: quello che il prodotto genera davvero.
 */
export const initialPages: Page[] = buildPagesFromScene({
  chapterId: "ep001",
  scene: sampleScene,
  firstPageNumber: 1,
  primaryTarget: TARGET,
  gutter: { x: 14, y: 18 },
  readingDirection: "ltr",
});

export const initialScene = sampleScene;

/**
 * Capitolo di esempio già nella casella del copione: si preme "Spoglia" e si
 * vede la catena intera girare, senza dover prima inventarsi un testo.
 */
export const SAMPLE_SCRIPT = `# Il faro di Capo Vento — esterno, alba

Il faro si staglia sulla scogliera. La lanterna in cima è spenta.

Sara risale il sentiero con la borsa degli attrezzi in spalla. Elio la aspetta sulla porta.

SARA: È spenta da quanto?
ELIO: Dalle due. Ho provato di tutto.

Elio le mostra il quadro elettrico: un alone nero attorno all'interruttore generale.

Sara riconosce la bruciatura. L'ha già vista, tre anni prima, in un altro faro.

# In cima alla torre

Sara sale la scala a chiocciola due gradini alla volta.

La lente della lanterna non c'è più. L'alloggiamento è vuoto, le viti allineate sul pavimento.

SARA: Nessun segno di scasso.
ELIO: Aveva le chiavi.

Elio abbassa lo sguardo.

ELIO: Le chiavi di riserva mancano da settimane. Te lo dovevo dire prima.

Sara si affaccia al parapetto e guarda la strada costiera che scende verso il paese.
`;
