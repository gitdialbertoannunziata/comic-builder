# Piano di progetto — strumento storia → fumetto

**Revisione 2** — 13 settembre 2026
Sostituisce la bozza precedente. Le sezioni marcate **[DA DECIDERE]** sono scelte aperte, non raccomandazioni; dove esiste una raccomandazione è indicata come *Raccomandazione* e resta una scelta, non una decisione presa.

---

## 0. Stato della revisione

### 0.1 Cosa è cambiato rispetto alla bozza

| # | Modifica | Sezione |
|---|---|---|
| 1 | **Target deciso**: autore seriale webtoon/manga ad alto volume, non "creator seriale" generico né utente occasionale | §2 |
| 2 | **Camera direction** promossa a contratto del modello (enum chiusi + tabella beat→camera + lint), non un campo di testo libero | §6, §9 |
| 3 | **Griglia** riscritta: da righe partizionate a tracce+aree con span, ordine di lettura esplicito e validazione; due modalità (`page`, `strip`) | §7 |
| 4 | **Collegamento mancante** fra documento e generazione: `promptCompiler` → `RenderSpec`, con cache indirizzata per contenuto e staleness calcolata al posto del flag `dirty` | §9 |
| 5 | **Livello "scena"** fra prosa e pagina; id stabili e non posizionali, perché il re-run dello script non distrugga le modifiche a mano | §5, §10 |
| 6 | **Formati come asse di prima classe**: il webtoon scroll entra nel perimetro; riformattazione e revisioni diventano le due feature portanti | §4, §10 |
| 7 | **Lettering** come motore di prima classe (dimensione font in unità di pagina, misurazione dei glifi, tipi di balloon, layer separato) | §8 |
| 8 | **Roadmap**: F3–F5 (arte AI) diventano estensione opzionale; nuove fasi deterministiche per export multi-formato e revisioni | §12 |
| 9 | **Architettura**: tre interfacce di servizio (`ImageService`, `LlmService`, `PlatformService`) più `RenderQueue` | §11 |

### 0.2 Cosa resta aperto

| Aperto | Blocca | Sezione |
|---|---|---|
| Formato canonico (pagina o striscia) | Lay-out primario e direzione delle conversioni | §14.1 |
| Stile grafico di riferimento | Preset di stile, palette, toni | §14.2 |
| Ore settimanali disponibili | Fattibilità della roadmap | §14.3 |
| Tauri vs Electron | Solo il packaging (reversibile grazie a `PlatformService`) | §14.4 |
| Hardware disponibile | Solo il ramo AI opzionale (F4) | §14.5 |
| Lingua dell'interfaccia e dei fumetti | Prompt del LLM, font del lettering | §14.6 |

### 0.3 Come leggere i numeri della roadmap

Le durate in §12 sono in settimane serali (8–10 h/settimana) e presuppongono una persona sola. La stima della **v1 utile** (fino a F2.5 inclusa) è **13–16 settimane**. Il ramo AI (F3–F5) è opzionale e va deciso dopo aver visto la v1 in uso reale.

---

## 1. Tesi del progetto

Gli strumenti esistenti producono un'immagine finita. Questo produce un **documento strutturato e rieditabile**: griglia delle vignette, balloon, dialoghi e riferimenti ai personaggi vivono come dati, non come pixel.

Due conseguenze, che con il target di §2 diventano il prodotto stesso:

- **Un documento, N uscite.** La stessa pagina diventa albo stampato, pagina digitale, striscia verticale webtoon e metadata di panel view. Possibile solo perché i pixel non sono il documento.
- **Editing granulare e revisioni tracciate.** Sposti un balloon, allarghi una vignetta, reimporti le correzioni dello sceneggiatore e riletteri solo i balloon toccati, lasciando intatto tutto il resto.

L'arte — disegnata dall'autore o generata, in un caso o nell'altro — è un **layer** dentro quella struttura, non il documento.

Con questo target la tesi si rafforza: l'AI non è più il motore dell'arte ma un'estensione opzionale, e le due feature portanti (riformattazione, revisioni) sono deterministiche, testabili e impossibili da replicare su un documento a pixel.

## 2. Utente target

**Deciso: autore seriale di webtoon/manga ad alto volume, digitale-first.** Pubblica a cadenza settimanale o bisettimanale, produce molte pagine e pannelli per episodio, lavora con uno sceneggiatore e propone la stessa storia su più formati.

### 2.1 Candidati valutati

| Candidato | Dolore principale | Perché non è il primo utente |
|---|---|---|
| Creator seriale di webcomic (ipotesi della bozza) | Coerenza dei personaggi su 50+ pagine | Si risolve disegnando o con LoRA: spinge il piano dentro il rischio ML invece di valorizzare il documento |
| Utente occasionale | Partire da zero senza saper disegnare | Mercato grande ma presidiato (Canva, Dashtoon); richiede backend gestito, billing e supporto: incompatibile con una persona sola la sera |
| Disegnatore che vuole assist AI sul proprio tratto | Mantenere la paternità del segno | Richiede ControlNet e una UI di sketch; segmento più ostile all'AI e con il dolore meno monetizzabile |
| **Autore seriale webtoon/manga ad alto volume** | **Riformattare tra formati, gestire le revisioni continue con lo sceneggiatore, tenere il ritmo produttivo** | **— scelto** |

### 2.2 Perché questo target rende il piano eseguibile

- Il dolore è **ricorrente e settimanale** (revisioni, uscita dell'episodio, secondo formato): la disponibilità a pagare è concreta, non teorica.
- Le due feature portanti sono **impossibili su un documento a pixel** e **quasi gratuite su un documento strutturato**: è la prova della tesi, non un'opinione.
- Il ramo AI (ComfyUI locale, LoRA, packaging dei modelli) **esce dal percorso critico**: F3–F5 diventano opzionali, e con essi il rischio ML, il costo per pannello e i requisiti hardware.
- Il formato a cartella con JSON diffabili si sposa con il lavoro a due mani (autore + sceneggiatore) **senza** costruire collaborazione in tempo reale, che resta non-obiettivo.

Il rischio cambia natura, in meglio: si passa da un rischio ML (qualità della coerenza, fragilità dei workflow) a un rischio ingegneristico ordinario e testabile (layout, lettering, slicing, diff). Per un progetto a una persona sola la sera è lo scambio giusto.

### 2.3 Vincoli che il target impone

| Vincolo | Effetto sul progetto |
|---|---|
| Alto volume: 200+ pagine e migliaia di balloon per serie | Virtualizzazione della vista, cache delle miniature, operazioni batch, board dell'episodio |
| Uscita seriale a episodi | Gerarchia serie → episodio → pagina → pannello; **id stabili non posizionali** perché pagine e scene si spostano di continuo |
| Manga (lettura da destra a sinistra) | `reading_direction` separato da `text_direction`, gestito negli algoritmi fin da F0 |
| Webtoon (scroll verticale, giunzioni invisibili) | Modalità `strip` nella griglia più politica di slicing |
| Revisioni continue con lo sceneggiatore | Provenienza per pannello, diff dello script, lista di correzioni, re-lettering selettivo |
| Specifiche di piattaforma che cambiano | I target di uscita sono **dati di configurazione**, non codice cablato |
| Uso professionale e a stampa | DPI, bleed, area sicura, PDF, font con licenza dichiarata |

## 3. Non-obiettivi (v1)

Restano fuori dal perimetro:

- **Editor di disegno.** Non si disegna a mano dentro lo strumento: l'arte entra da fuori (import) o viene generata (ramo AI opzionale).
- **Collaborazione in tempo reale.** Autore e sceneggiatore si scambiano *file* (export leggibile, import di correzioni), non sessioni condivise.
- **Pubblicazione e distribuzione.** Nessun upload alle piattaforme, nessun catalogo, nessuna analytics, nessun CMS.
- **Traduzione e localizzazione** come flusso di lavoro. Il documento è multilingua-friendly, ma la gestione delle varianti di lingua arriva dopo.
- **Animazione, audio, motion comic.**
- **Griglie annidate** (nested). Il guadagno espressivo non vale la complessità di validazione né gli errori indotti nel modello linguistico.

Entrano invece nel perimetro, al contrario di quanto diceva la bozza:

- **Webtoon scroll verticale**, come target di uscita con politica di slicing (§4, §7.2).
- **Riformattazione** fra i formati della stessa opera (§4).
- **Revisioni tracciate** con lo sceneggiatore: lista di correzioni, changelog, re-lettering selettivo (§10).

Fuori dal percorso critico, rimandabili senza conseguenze sull'architettura:

- Arte generata (F3–F5), ComfyUI locale (F4), LoRA (F5), bundling dei modelli (parte di F6).

## 4. Formati di uscita

Il formato è un **asse di render**, non un'impostazione di export: i `targets` sono dichiarati nel progetto e ogni pagina può avere varianti per target.

| target | tipo | vincoli | output |
|---|---|---|---|
| `print-b5` | pagina fissa | 182×257 mm, 600 dpi, bleed 3 mm, area sicura, scala di grigi, RTL | PDF pagine + PNG |
| `digital-page` | pagina fissa | 1600×2400 px, sRGB, RTL | PNG/JPEG per lettore |
| `webtoon-strip` | striscia verticale | larghezza 1080 px, slice ≤ 1280 px, seam nullo, JPEG | N JPEG per episodio |
| `guided-view` | regioni | deriva dai box dei pannelli | metadata regioni (Kindle, Comixology, Kobo) |
| `cbz` | contenitore | — | archivio di uno qualunque dei target |

Valori indicativi: le specifiche reali delle piattaforme vanno tenute in configurazione (Appendice C).

### 4.1 Regole che rendono sostenibile il multi-formato

1. **Un solo target è canonico**: quello in cui si autora. Gli altri sono derivati. **[DA DECIDERE — §14.1]**
   *Raccomandazione*: pagina come canonico. È il formato più vincolato e più strutturato, e la striscia è una derivazione verticale di pannelli che possiedi già; la paginazione a partire da una striscia è sotto-determinata, perché non esiste un criterio non arbitrario per decidere dove spezzare, mentre lo slicing di una pagina ha regole chiare (gutter, balloon, volti).
2. **Un solo target è ritoccabile a mano in v1.** Gli altri restano `derived`. Questo tiene a freno lo scope creep peggiore del piano: N formati × N lay-out da mantenere.
3. **La riformattazione non è un resize: è un re-layout.** Un pannello 2:3 convertito in una slice 3:4 cambia la geometria dei balloon, quindi servono override di posizionamento per target. Il documento garantisce che *il contenuto* non vada rifatto, non che l'impaginazione sia automatica a costo zero: dirlo nel piano, non scoprirlo in F2.
4. **Il lettering costa secondi, l'arte costa minuti e denaro.** Da qui la separazione dei layer: cambiare formato o applicare una correzione di dialogo rigenera solo il layer lettering (SVG deterministico), mai l'arte.

### 4.2 Perché `guided-view` è nel piano v1

I box dei pannelli che il Core calcola comunque per disegnare la pagina **sono** i metadata di panel view richiesti dai lettori digitali. È una feature che nessuno strumento consumer offre, costa pochissimo e nasce soltanto da un documento strutturato: è la tesi del progetto applicata dentro il perimetro v1. Un seriale che pubblica anche in digitale la usa a ogni episodio.

## 5. Modello dati

Il formato è il cuore del progetto: se è giusto, tutto il resto è sostituibile.

### 5.1 Progetto = cartella

```
serie-il-garage.comic/
  project.json            # metadati, target di uscita, stile, font, indici
  scenes.json             # breakdown narrativo: l'unità di continuità
  chapters.json           # episodi: titolo, pagine, stato
  pages/ep012-p003.json
  characters/marco.json   # scheda + puntatore all'asset
  characters/marco-sheet/03.png
  art/ep012-p003-03.psd   # arte SORGENTE dell'autore (versionata, LFS)
  renders/                # output di macchina e cache (ignorata da git)
  style/presets.json
  fonts/*.woff2           # libreria font con licenza dichiarata
  revisions/cap-012.json  # changelog delle correzioni
  script/cap-012.md       # prosa sorgente
  .gitignore              # renders/
```

Motivazioni, in ordine di importanza:

- **`art/` (sorgente) separata da `renders/` (derivata).** Con arte disegnata dall'autore, `renders/` non è più "cache rigenerabile dal documento": l'arte dell'autore è la fonte di verità e non si rigenera mai. Solo `art/` va versionata (con LFS); `renders/` si cancella senza perdite.
- **Cartella e non file singolo**: gli asset binari sono grandi e non appartengono al JSON.
- **JSON per pagina**: diffabilità e conflitti rari in git, anche con due persone che lavorano (autore, sceneggiatore).
- **`revisions/` separata**: un changelog non deve sporcare i file di pagina, che restano confrontabili.

### 5.2 project.json

```json
{
  "schema": 1,
  "id": "serie-il-garage",
  "title": "Il garage",
  "locale": "it-IT",
  "text_direction": "ltr",
  "reading_direction": "rtl",
  "series_seed": 20250913,
  "targets": [
    { "id": "digital-page",  "kind": "page", "size_px": [1600, 2400], "color": "srgb",
      "reading_direction": "rtl", "primary": true },
    { "id": "print-b5",      "kind": "page", "size_mm": [182, 257], "dpi": 600,
      "bleed_mm": 3, "color": "gray", "reading_direction": "rtl" },
    { "id": "webtoon-strip", "kind": "strip", "width_px": 1080, "slice_max_h": 1280,
      "seam": "none", "format": "jpeg" },
    { "id": "guided-view",   "kind": "regions", "source": "digital-page" }
  ],
  "page": { "margin": { "top": 56, "right": 56, "bottom": 56, "left": 56 } },
  "lettering": { "font_family": "OpenComicSans", "base_size_px": 26, "line_height": 1.35,
                 "padding": 12, "max_width_ratio": 0.62, "tail_width": 10 },
  "style": { "preset": "ink-flat",
             "positive": ["clean ink lineart", "flat cel shading", "muted palette"],
             "negative": ["photo", "3d render", "text", "watermark"] },
  "fonts": [ { "family": "OpenComicSans", "path": "fonts/OpenComicSans.woff2",
               "license": "OFL-1.1", "scope": "dialogue" } ],
  "chapters": "chapters.json",
  "scenes": "scenes.json",
  "app_version": "0.1.0",
  "created": "2026-09-13T00:00:00Z"
}
```

Campi su cui vale la pena fermarsi:

- **`schema`**: versionamento e catena `migrate(doc)`. Una riga oggi, una settimana di lavoro fra tre mesi.
- **`reading_direction` separato da `text_direction`**: un manga si legge da destra a sinistra anche se i balloon sono in italiano. Sono due proprietà diverse e vanno tenute distinte, perché la prima governa ordine dei pannelli e dei balloon nel pannello, la seconda solo il testo.
- **`series_seed`**: un solo seed di serie da cui derivano i seed automatici dei pannelli (§5.7), così cambiando un valore si rigenera l'intera opera in modo coerente.
- **`targets`**: il formato è un asse di render; `primary: true` indica il canonico. **[DA DECIDERE — §14.1]**
- **`lettering` in unità di pagina**: `base_size_px` è riferito alla larghezza di pagina, non al pannello. È il motivo per cui il testo resta coerente e leggibile anche in un pannello che occupa un sesto di pagina.
- **`fonts` con licenza dichiarata**: un professionista usa i suoi font commerciali; lo strumento non deve né sostituirli né esporre l'utente a violazioni.
- **`style`**: la "bibbia di stile" globale, usata dal ramo AI e come riferimento visivo per l'autore. Precedenza: progetto → pagina → pannello.
- **Le pagine non sono elencate qui**, ma in `chapters.json`: inserire o rinumerare pagine a metà serie è normalissimo e non deve toccare i metadati globali.

### 5.3 scenes.json e chapters.json

**`scenes.json`** — l'unità di continuità: luogo, tempo, personaggi, beat.

```json
{ "schema": 1, "scenes": [
  { "id": "s014", "title": "Il garage", "location": "garage di Marco", "time_of_day": "sera",
    "characters": ["marco"], "style_ref": null,
    "beats": [
      { "id": "s014-b1", "function": "establish", "summary": "Il garage vuoto, polvere controluce" },
      { "id": "s014-b2", "function": "reveal",    "summary": "Marco apre la porta e resta immobile" }
    ] }
] }
```

**`chapters.json`** — episodi e ordine delle pagine.

```json
{ "schema": 1, "chapters": [
  { "id": "ep012", "number": 12, "title": "Il garage", "status": "in-production",
    "due": "2026-10-02",
    "pages": ["ep012-p001", "ep012-p002", "ep012-p003"] }
] }
```

Perché una **scena** e non solo pagine: la scena è l'unità con cui si ragiona su continuità (asse dei 180°, luce, costumi), su coerenza di stile, su re-run parziale dello script e su lint. Senza di essa i pannelli gallegano agganciati solo alla pagina e nessuna verifica di coerenza ha una base. Il `function` del beat è ciò che alimenta la tabella beat→camera (§6.2): non un'etichetta decorativa, ma l'input del contratto con il modello.

**Gerarchia completa**: serie → episodio (`chapters.json`) → pagina → pannello → balloon, con le scene che attraversano le pagine e raggruppano i beat.

**Id stabili e non posizionali**: `ep012-p003-03` è derivabile da episodio, pagina e indice, non un contatore globale. In serializzazione le pagine si inseriscono, si spostano e si rinumerano di continuo: un id posizionale è una bomba a orologeria.

### 5.4 Pagina

```json
{
  "schema": 1,
  "id": "ep012-p003",
  "chapter_id": "ep012",
  "order": 3,
  "spread_with": null,
  "layout": {
    "mode": "page",
    "primary_target": "digital-page",
    "template_id": "classic-6",
    "cols": [1, 1, 1],
    "rows": [1, 1, 0.8],
    "gutter": { "x": 14, "y": 18 },
    "reading_order": ["ep012-p003-01", "ep012-p003-02", "ep012-p003-03",
                      "ep012-p003-04", "ep012-p003-05", "ep012-p003-06"]
  },
  "variants": {
    "webtoon-strip": {
      "status": "derived",
      "slice": { "max_height": 1280, "min_height": 640, "seam": "none",
                 "avoid": ["balloons", "faces"], "prefer": "gutter" },
      "balloon_overrides": []
    }
  },
  "panels": [],
  "overlays": []
}
```

- **`order` separato da `id`**: inserire una pagina in mezzo a un episodio già pubblicato è un'operazione ordinaria.
- **`spread_with`**: in manga cartaceo la doppia pagina è l'unità di lay-out; in digitale la doppia si spezza. Va deciso se il lay-out primario è la pagina o la doppia, ma il campo esiste dal primo giorno così la scelta non diventa una migrazione.
- **`variants`**: `status: "derived"` significa "si aggiorna da solo quando cambia il lay-out canonico"; `status: "tuned"` significa "questo formato l'ho ritoccato a mano", ed è l'unico che genera avvisi di riallineamento. Senza questo campo, il multi-formato diventa una giungla di disallineamenti silenziosi.
- **`reading_order` esplicito**: con una griglia a span l'ordine dell'array non è più l'ordine di lettura, e va validato come permutazione dei pannelli.
- **`overlays`**: balloon e cartigli a livello di pagina, per il caso che le ancore normalizzate al pannello non possono esprimere (un cartiglio che attraversa il gutter).

### 5.5 Pannello

```json
{
  "id": "ep012-p003-03",
  "scene_id": "s014",
  "beat_index": 1,
  "source": { "file": "script/cap-012.md", "from_line": 41, "to_line": 58 },
  "area": { "col": 2, "row": 1, "col_span": 2, "row_span": 1 },
  "border": { "style": "solid", "width": 3, "radius": 0 },
  "camera": {
    "shot": "MS", "angle": "low", "lens_mm": 35, "dof": "deep",
    "lighting": "backlit", "mood": "tense", "motion": "static",
    "subject_placement": "left-third", "axis_side": "A-left"
  },
  "action": "Marco spinge la porta del garage e si ferma",
  "setting": "garage, polvere sospesa, sera",
  "props": ["porta basculante", "auto coperta da un telo"],
  "continuity_notes": "giacca strappata al gomito sinistro da ep012-p002",
  "characters": [
    { "ref": "marco", "weight": 0.75, "role": "lead",
      "framing": "head-and-torso", "expression": "teso", "wardrobe": "default" }
  ],
  "art": { "source": "art/ep012-p003-03.psd", "status": "inked" },
  "prompt": { "override": null, "negative_override": null },
  "control_image": null,
  "seed": { "mode": "auto", "value": null, "epoch": 0 },
  "render": {
    "digital-page": { "spec_hash": "9f2ab31c",
                      "file": "renders/ep012-p003-03@digital-page.9f2ab31c.png",
                      "engine": "replicate:ip-adapter@v2",
                      "rendered_at": "2026-09-14T21:03:11Z" },
    "webtoon-strip": null
  },
  "balloons": []
}
```

- **`camera`** è un oggetto a enum chiusi (§6.1), non una stringa: è ciò che il compilatore mappa in prompt e ciò che il lint verifica.
- **`action`, `setting`, `props`, `continuity_notes`** sono testo libero *di contenuto*, ed è l'unico posto dove il testo libero è ammesso. Per un autore che disegna sono la specifica di disegno: più dettagliate del prompt di un modello.
- **`art`** è l'arte sorgente dell'autore, con uno stato di lavorazione; **`render`** è l'output di macchina, per target.
- **`control_image`** esiste da subito nello schema anche se la v1 non lo usa: se un domani l'autore vuole l'assist sul proprio tratto, è un ControlNet scribble/lineart e non serve toccare il formato.
- **`seed`**: `mode: "auto"` calcola `seed = fnv1a(series_seed, page_id, panel_id)`; `mode: "override"` fissa un valore; `epoch` incrementa per un reroll locale senza perdere il valore storico.

### 5.6 Balloon

```json
{
  "id": "ep012-p003-03-b1",
  "type": "speech",
  "speaker": { "ref": "marco", "visible": true, "offscreen_dir": null },
  "text": [ { "t": "Non c'è più " }, { "t": "niente", "em": "bold" }, { "t": " qui dentro." } ],
  "anchor": { "x": 0.22, "y": 0.15 },
  "tail": { "mode": "auto", "target": { "x": 0.40, "y": 0.62 } },
  "size_mode": "grow",
  "font_scale": 1.0,
  "per_target": { "webtoon-strip": { "anchor": { "x": 0.30, "y": 0.72 }, "font_scale": 1.15 } },
  "z": 2,
  "rev": 3
}
```

- **Coordinate normalizzate** (0–1) rispetto al pannello: il lay-out si ridimensiona senza ricalcoli.
- **`text` come run**, non stringa: l'enfasi in un fumetto è semantica (`em: bold | italic | small`), non decorazione.
- **`per_target`**: l'override di posizionamento per formato. È il campo che rende onesta la promessa di riformattazione (§4.1).
- **`rev`**: numero di revisione del testo, collegato al changelog (§10) per sapere quando un balloon è cambiato e va riletterato.

### 5.7 Render, cache e staleness

```
renders/ep012-p003-03@digital-page.9f2ab31c.png    # l'immagine
renders/ep012-p003-03@digital-page.9f2ab31c.json   # lo spec che l'ha prodotta
```

La cache è **indirizzata per contenuto**: l'hash è quello dello `RenderSpec` canonico (§9.1), che include modello, sampler, passi, cfg, versioni degli asset, pesi, seed, dimensioni e target. Conseguenze:

- Niente sovrascritture accidentali, storia dei render, GC banale.
- **La staleness è calcolata, non salvata**: `stale(panel, target) = spec_hash != hash(compile(panel, target))`. Il flag `dirty` della bozza sparisce: un booleano che qualcuno deve ricordarsi di aggiornare è una fonte garantita di stati incoerenti.
- Il sidecar è il record di riproducibilità: dice *perché* quel render è così. "Il determinismo dal seed" è vero solo se modello, sampler e workflow sono fissati e registrati.

### 5.8 Regole ferme

1. **Nessun pixel nel JSON.** Il documento resta leggibile, diffabile, piccolo.
2. **Coordinate normalizzate** nel documento; i pixel esistono solo nel renderer e non si salvano mai.
3. **Id stabili e non posizionali** per episodi, pagine e pannelli.
4. **Enum chiusi** per tutto ciò che il compilatore mappa (camera, tipi di balloon, formati); **testo libero solo per il contenuto**.
5. **Niente arte sorgente in `renders/`**, niente output di macchina in `art/`.
6. **La cache si può cancellare in qualsiasi momento** senza perdere nulla di irrecuperabile.

## 6. Camera direction

La bozza aveva `"shot": "medium"` come stringa libera e non incaricava il modello di produrla. Qui diventa un **contratto**: enum chiusi, mappatura deterministica, verifica automatica.

### 6.1 Vocabolario chiuso

| Campo | Id | Etichetta UI | Frammento per il compilatore |
|---|---|---|---|
| `shot` | `EWS` | campo lunghissimo | extreme wide shot, tiny subject in vast space |
| | `LS` | campo lungo | wide shot, full figure in environment |
| | `MLS` | campo medio | medium long shot, knees up |
| | `MS` | piano americano | medium shot, waist up |
| | `MCU` | mezzoprimo piano | medium close-up, chest up |
| | `CU` | primo piano | close-up, face fills frame |
| | `ECU` | primissimo piano | extreme close-up, eyes |
| | `INSERT` | dettaglio | insert shot of object |
| `angle` | `eye` | inquadratura | eye level |
| | `low` | dal basso | low angle looking up, imposing |
| | `high` | dall'alto | high angle looking down, vulnerable |
| | `birds` | a picco | birds-eye view, top down |
| | `worms` | supina | worms-eye view, ground level |
| | `dutch` | olandese | dutch angle, tilted horizon, unease |
| | `ots` | over-the-shoulder | over-the-shoulder framing |
| | `pov` | soggettiva | first-person POV |
| `lens_mm` | `24` `35` `50` `85` `135` | focale | 24mm wide, exaggerated perspective / 85mm compressed perspective |
| `dof` | `shallow` `deep` `split` | profondità di campo | shallow depth of field, blurred background |
| `lighting` | `flat` `backlit` `rim` `hard` `soft` `practical` `night` `golden` | luce | backlit, rim light / hard shadows, high contrast |
| `mood` | `calm` `tense` `dread` `warm` `grief` `action` `wonder` `ironic` | tono | — (agisce su palette, postura e composizione, non su un frammento) |
| `motion` | `static` `implied` `pan` `dolly` `zoom` | movimento | motion blur, speed lines (solo per `implied`) |
| `subject_placement` | `left-third` `center` `right-third` `two-shot` `none` | posizione soggetto | subject on left third |
| `axis_side` | `A-left` `A-right` | asse di scena | — (metadato per il lint, non entra nel prompt) |

Due valori non entrano mai nel prompt: `mood` e `axis_side`. Il primo governa scelte compositive e cromatiche, il secondo esiste solo per la continuità. Tenerli separati evita di scrivere prompt che "descrivono" cose che il modello non controlla.

### 6.2 Chi produce la camera

- **Il modello (F1)**, con regole esplicite e non a sentimenti. La tabella beat→camera qui sotto è più efficace di qualsiasi istruzione in prosa: riduce la varianza in modo misurabile e rende l'output verificabile.
- **L'autore**, che può sovrascrivere ogni campo in un colpo solo. Per chi disegna, la camera è la **specifica di disegno**: il pannello deve dire cosa disegnare, e la UI deve rendere questa modifica rapidissima (icone, scorciatoie, non un form di dieci campi).

| Funzione del beat | Default | Variante se il beat è intenso |
|---|---|---|
| Stabilire luogo/scena | `EWS`/`LS`, `high`, `24mm` | `dutch` |
| Ingresso personaggio | `MLS`, `eye`, `35mm` | `low` |
| Dialogo A↔B | `MCU`, `ots`, `85mm`, alternando `axis_side` | `CU` |
| Reazione interiore | `CU`/`ECU`, `shallow` | `INSERT` su oggetto |
| Rivelazione | `LS` con soggetto piccolo | `ECU` + `dutch` |
| Azione | `MS`, `low`, `24mm` | `motion: implied` |
| Chiusura o pausa | `LS`/`EWS`, `static` | pannello vuoto, senza personaggi |

### 6.3 Regole di ritmo (validate a valle, non solo suggerite)

- 3–6 pannelli per pagina; non più di 5 righe di lay-out.
- Massimo 2 pannelli consecutivi con lo stesso `shot`.
- Almeno un cambio di `shot` ogni 2 pannelli.
- Ogni pagina contiene almeno un `LS` o un `INSERT` (evita la pagina "tutti primi piani").
- Almeno un pannello di respiro (`LS`/`EWS`) ogni scena.

### 6.4 Continuità

Regola dei 180° (coerenza di `axis_side` nelle coppie botta-e-risposta), eyeline match fra pannelli adiacenti, jump cut (stesso `shot` + `angle` + setting consecutivi), copertura del dialogo (ogni balloon ha uno speaker noto o è marcato `visible: false`), coerenza di luogo/luce/costumi dentro la scena. Elenco operativo in Appendice A.

Perché conta: il Core non sa niente di immagini ma sa tutto di geometria e ordine. Un linter deterministico è economico, non richiede GPU e per un autore seriale è un controllo di qualità che nessuno strumento consumer offre.

## 7. Gestione della griglia

La bozza esprimeva il lay-out come `"rows": [[1], [2, 1], [1]]`: solo righe a tutta larghezza partizionate. Con quel formato non si può esprimere un pannello che occupa due righe (la pagina a T o a L), una colonna più stretta dell'altra, un inset, uno splash, un pannello senza bordo, né — soprattutto — un ordine di lettura esplicito. La griglia diventa quindi **tracce + aree**, su due modalità.

### 7.1 Modalità `page` (pagina fissa)

```json
{
  "layout": {
    "mode": "page",
    "cols": [1, 1, 1],
    "rows": [1, 1, 0.8],
    "gutter": { "x": 14, "y": 18 },
    "reading_order": ["..."]
  }
}
```

e per ogni pannello:

```json
{
  "area": { "col": 2, "row": 1, "col_span": 2, "row_span": 1 },
  "border": { "style": "solid", "width": 3, "radius": 0 }
}
```

`cols` e `rows` sono pesi `fr`; i box in pixel sono calcolati da una funzione pura (`resolveLayout`) e **non si salvano mai** nel documento. Così il JSON resta diffabile e i pixel esistono in un solo posto: il renderer.

**Validazione** (`validateDocument()`, condivisa fra output del modello, apertura file ed edit della UI):

- le aree **tassellano** la griglia: nessun buco, nessuna sovrapposizione non dichiarata (gli inset dichiarano `z` esplicito);
- gli span restano nei limiti delle tracce;
- `reading_order` è una permutazione completa e senza duplicati dei pannelli;
- `gutter`, margini e bleed sono coerenti con la dimensione di pagina del target;
- le ancore dei balloon sono in `[0,1]`.

Una sola funzione di validazione usata da tutti e tre gli ingressi è la difesa più economica contro documenti incoerenti, qualunque sia la loro provenienza.

**Uscita di sicurezza per il page design**: `border.style: "none"` ammette pannelli senza bordo (obbligatorio per il webtoon e comune nei manga); `shape: {"type": "polygon", "points": [...]}` è previsto **più avanti**, non in v1, perché complica il tiling e richiede point-in-polygon per l'ancoraggio dei balloon. Il modello a tracce copre la grande maggioranza del page design reale, il resto arriva dopo.

**Niente griglie annidate** (§3): rompono la validazione del tiling e confondono il modello linguistico.

### 7.2 Modalità `strip` (scroll verticale)

Per la striscia non esiste una pagina: esiste una **sequenza**. Il modello è un caso particolare della griglia, non un sistema a parte:

```json
{
  "layout": {
    "mode": "strip",
    "width_ratio": 1,
    "panel_gap": 0,
    "sequence": ["ep012-p003-01", "ep012-p003-02", "ep012-p003-03"]
  }
}
```

`panel_gap: 0` e pannelli senza bordo sono la norma: le giunzioni devono essere invisibili.

**Politica di slicing** (conversione pagina → striscia):

```json
{
  "slice": { "max_height": 1280, "min_height": 640, "seam": "none",
             "avoid": ["balloons"], "prefer": "gutter", "overlap_px": 8 }
}
```

- Le linee di taglio cadono **preferibilmente nei gutter**, con tolleranza di altezza fra `min_height` e `max_height`.
- **Mai a metà di un balloon**: il taglio non deve spezzare una nuvola di testo — è l'errore che rende un webtoon immediatamente amatoriale.
- `overlap_px` e bleed alle giunzioni eliminano la riga bianca fra due immagini consecutive.
- **Correzione di onestà rispetto a un'assunzione diffusa**: i balloon sono geometria nota, quindi `avoid: ["balloons"]` è deterministico; *i volti no*. Evitare i volti richiede un rilevamento (una passata di face detection) oppure bande di esclusione disegnate a mano dall'autore. In v1: gutter e balloon obbligatori, volti affidati a bande manuali; la face detection è un miglioramento successivo, non un presupposto.

Lo slicing è un **algoritmo**, quindi va testato come tale: immagini golden, casi limite (pannello più alto di una slice, pannello più basso di `min_height`, pagina con un solo pannello).

### 7.3 Template

Catalogo di partenza: `classic-6`, `grid-3x3`, `top-splash-3`, `t-layout`, `sidebar-2`, `strip-4`, `splash`, `nine-grid-dialogue` (dettaglio in Appendice B). Ogni template è una tupla deterministica `{cols, rows, areas[], reading_order}` che si espande in tracce e aree.

- **Il modello sceglie dal catalogo**, non inventa: il prompt elenca i template disponibili (grounding) e ammette `custom` solo con tracce esplicite.
- **L'editor mostra miniature**: scegliere un template deve essere un clic, non una compilazione di campi.
- `template_id` è conservato insieme alle tracce espanse: serve a capire da dove viene un lay-out e a riapplicare le regole del template dopo un edit manuale.

### 7.4 Conseguenza da tenere a mente: la griglia determina l'aspect ratio

**La griglia non è cosmetica: determina il rapporto di ogni pannello e quindi entra nella chiave del render.** Spostare un gutter cambia la geometria di alcuni pannelli, manda stale la loro arte e — nel ramo AI — ne cambia la generazione. Due conseguenze operative:

1. Prima di applicare un cambio di griglia la UI mostra l'impatto: «14/120 pannelli da rigenerare — ~21 min, ~0,55 €» nel ramo AI, oppure «14 pannelli da ridisegnare» nel ramo manuale. La stima è possibile proprio perché la staleness è calcolata (§5.7).
2. Nel ramo AI i modelli vogliono rapporti supportati (SDXL: 1024², 832×1216, 1216×832…). Un pannello 3:2,3 non esiste: serve uno **snap al bucket supportato** con cover-crop, un `crop_anchor` per pannello e una **guida "area sicura"** nell'editor, altrimenti lo strumento taglia le teste e sembra un bug. Nel ramo manuale il problema non esiste: si disegna al rapporto che serve.

## 8. Lettering

La bozza indicava i balloon come «la parte più sottovalutata», ma lo schema dei balloon non aveva nemmeno la dimensione del font. Per un autore seriale il lettering è una funzione centrale: è la parte che si ripete a ogni episodio, che le revisioni toccano più spesso e che si vede di più quando è fatta male.

### 8.1 Regole di dimensionamento

- **La dimensione del font è in unità di pagina**, non di pannello: `lettering.base_size_px` è riferito alla larghezza di pagina, e `font_scale` per balloon è un moltiplicatore. Con le ancore normalizzate al pannello, un pannello largo un terzo di pagina erediterebbe testo gigantesco se la dimensione fosse relativa al pannello: il testo resterebbe illeggibile in un caso e sproporzionato nell'altro.
- **Misurazione reale dei glifi** (`opentype.js`, eseguibile headless): il reflow non può basarsi su stime di caratteri medi, altrimenti il testo sborda di uno o due caratteri esattamente nei casi che contano. La misurazione reale rende i test deterministici e la resa identica fra editor, export e stampa.
- **Andata a capo**: bilanciamento delle righe (evitare l'ultima riga con una parola sola) e hyphenation per locale. `it-IT` e `en-US` hanno regole diverse: la lingua è già nel progetto (`locale`).
- **Crescita del balloon**: si calcola la forma minima che contiene testo più padding; non esistono balloon disegnati a mano con dentro testo che sborda. Se il testo non entra in nessuna forma accettabile, la `font_scale` si riduce entro limiti dichiarati e la UI avvisa — **non si lascia testo che esce dal balloon**.

### 8.2 Coda, tipi, ordine

- **Coda automatica**: agganciata al punto dell'arco più vicino alla bocca dello speaker; se nel pannello ci sono più volti, `tail.target` esplicito risolve l'ambiguità. La coda non deve attraversare il testo né uscire dal pannello (la lunghezza massima è vincolata dal gutter).
- **Tipi di balloon**: `speech`, `thought`, `whisper`, `shout`, `caption`, `sfx`, `offpanel` (telefono, radio, voce fuori campo). Quest'ultimo è ciò che permette di avere uno speaker non visibile nei dati, invece di lasciare il campo vuoto.
- **Ordine di lettura dei balloon dentro il pannello** segue `reading_direction` (in un manga: dall'alto in basso e da destra a sinistra). È lo stesso flag dei pannelli: gestirlo fin dall'inizio costa poco, retrofittarlo costa una fase.
- **Markup inline** (`em: bold | italic | small`): l'enfasi in un fumetto è semantica, non decorativa.

### 8.3 Layer e export

Il lettering è un **layer separato** dall'arte, disegnato in SVG sopra l'immagine:

- si può **rigenerare da solo** in millisecondi, senza toccare l'arte: è la ragione per cui applicare una correzione di dialogo o cambiare formato costa secondi e non denaro;
- si può **esportare l'arte pulita** senza testo (utile per edizioni in altre lingue, o per consegnare l'arte a un letterista esterno);
- l'export SVG conserva i layer separati; per la stampa esiste l'opzione **testo → path**, che rende il file portabile senza dipendere dai font installati (a costo di un file più grande e non più modificabile nel testo).

### 8.4 Font

Libreria font **per progetto**, con licenza dichiarata e `scope` (dialogo, didascalia, effetto). Un professionista usa i suoi font commerciali: lo strumento non deve né sostituirli con "font comic gratuiti" né esporre l'autore a violazioni. I font di partenza per i nuovi progetti devono essere open (es. OFL), ma sostituibili in un clic.

### 8.5 Criteri di qualità (misurabili, da usare come test)

- Nessun balloon con testo che sborda o con una riga di una sola parola, su un corpus di pagine di prova.
- Lettere leggibili al 100% di zoom sulla larghezza di pagina del target digitale.
- Nessun taglio di balloon nello slicing (§7.2).
- Relettering di un episodio di 20 pagine: sotto i 2 secondi.

## 9. Compilatore, RenderSpec e pipeline

Questa è la parte che nella bozza mancava del tutto: fra il documento e l'immagine non c'era nessun livello, e questo rendeva impossibili sia il determinismo dichiarato sia i test.

### 9.1 RenderSpec (ramo AI, opzionale)

```json
{
  "target": "digital-page",
  "width": 832, "height": 1248, "aspect": "2:3",
  "positive": "medium shot, low angle looking up, imposing, 35mm lens, backlit, rim light, dusty garage at dusk, man in his 40s, short beard, worn leather jacket, tense expression, clean ink lineart, flat cel shading, muted palette",
  "negative": "photo, 3d render, text, watermark, extra fingers, cropped head, deformed hands",
  "seed": 44812,
  "model": "sdxl-base@6f7c...",
  "sampler": { "name": "dpmpp_2m", "steps": 28, "cfg": 5.5 },
  "ip_adapter": [ { "ref": "characters/marco-sheet/03.png", "sha": "a91f...", "weight": 0.75 } ],
  "loras": [ { "ref": "characters/marco.safetensors", "sha": "77c2...", "weight": 0.8 } ],
  "control_image": null,
  "workflow": "comfy/txt2img-character@v3"
}
```

Perché questo oggetto conta:

1. **Il prompt è derivato, non salvato.** Compilare il documento in `RenderSpec` significa che migliorare il compilatore migliora retroattivamente tutti i progetti esistenti, mentre un prompt salvato per pannello resta congelato alla versione del giorno in cui è stato scritto. L'uscita di sicurezza è `prompt.override` per pannello, non il contrario.
2. **Locale e cloud ricevono lo stesso oggetto**, quindi la parità fra `ImageService` locale e remoto è testabile invece di essere una speranza.
3. **È l'unità di cache e di test**: `spec_hash = sha1(canonicalJson(spec))`, snapshot test sul compilatore, sidecar per la riproducibilità (§5.7).
4. **La precedenza dello stile è dichiarata**: progetto → pagina → pannello → `prompt.override`. Senza un ordine esplicito il multi-livello diventa imprevedibile.

### 9.2 Pipeline

```
documento → [1] resolveLayout  → box in px + aspect per pannello
          → [2] compile        → RenderSpec (puro, deterministico)
          → [3] cache/render   → hit: file esistente · miss: ImageService
          → [4] compositing    → arte clippata nel path + bordo      (layer 1)
                                 balloon e lettering                 (layer 2)
                                 guide e aree sicure                 (layer 3, solo editor)
          → [5] export         → SVG · PNG/JPEG · PDF · CBZ · regioni guided view
```

Due precisazioni che evitano di costruire la cosa sbagliata:

- **I passi [1], [4] e [5] servono sempre**, anche nel ramo manuale (l'autore importa l'arte e lo strumento compone, lettera ed esporta). I passi [2] e [3] esistono **solo** nel ramo AI. Questo significa che la v1 utile non dipende da nessun modello, e il ramo AI si innesta dopo senza rimettere in discussione nulla.
- **Serve la geometria prima della generazione**: l'aspect ratio di un pannello viene dal suo box, quindi non si può compilare lo spec prima di aver risolto il lay-out. "Un solo giro di render" non esiste.

Nel ramo manuale l'equivalente della staleness è il **cambio del file d'arte**: si registra `art.sha` al momento della composizione e il pannello risulta da ricomporre quando il file cambia. È la stessa idea, applicata al ramo che non genera nulla.

### 9.3 Coda, costi, parità

Nel ramo AI servono, prima di poter contare sulla generazione: coda con concorrenza limitata, retry, cancellazione e ripresa, **stima preventiva di tempo e spesa** («120 pannelli: ~18 min, ~0,48 €») con tetto configurabile, e un **test di parità** che genera lo stesso `RenderSpec` su locale e su cloud per confrontare i risultati.

### 9.4 Il compilatore è anche il punto di innesto dell'assist

`control_image` nello `RenderSpec` e nel pannello (§5.5) è predisposto per un eventuale ControlNet scribble/lineart: se un giorno l'autore vuole l'assist sul proprio tratto, il documento non va toccato. Predisporre il campo ora costa zero, aggiungerlo dopo costa una migrazione.

## 10. Revisioni con lo sceneggiatore

È il dolore settimanale di un autore seriale ed è la funzione che nella bozza mancava del tutto. Non richiede collaborazione in tempo reale, che resta un non-obiettivo: si scambiano **file**.

### 10.1 Flusso

1. **Provenienza per pannello.** Ogni pannello ha `source: {file, from_line, to_line}` e ogni versione dello script ha un hash. Quando lo sceneggiatore rimanda il capitolo modificato, lo strumento sa dirti **quali pannelli sono toccati** dalla revisione.
2. **Export leggibile.** Si esporta il capitolo in un formato di lettura (Markdown o PDF) con id stabili dei pannelli e il testo dei balloon. Lo sceneggiatore annota dove vuole: Word, Docs, anche carta.
3. **Import e diff.** Si reimporta il file annotato: le differenze diventano una **lista di correzioni**, una per una, con accetta/rifiuta. È il 赤字 del manga, ma strutturato.
4. **Applicazione e re-lettering selettivo.** Applicata la correzione, si ridisegnano solo i balloon toccati. Gratis, perché il layer lettering è separato dall'arte (§8.3): l'arte non si tocca mai per un cambio di battuta.
5. **Changelog.** Ogni correzione è tracciata, con chi e quando, e con stato `open | applied | rejected`.

### 10.2 Changelog

File `revisions/cap-012.json`:

```json
{
  "schema": 1,
  "chapter_id": "ep012",
  "entries": [
    { "id": "r-0007", "at": "2026-09-14T09:12:00Z", "by": "sceneggiatore",
      "panel": "ep012-p003-03", "balloon": "ep012-p003-03-b1",
      "kind": "text",
      "from": "Non c'è più niente qui dentro.",
      "to": "Qui dentro non è rimasto niente.",
      "source_line": 44,
      "status": "open" }
  ]
}
```

`balloon.rev` (§5.6) e le voci del changelog si tengono allineati: è ciò che permette di sapere *quali* balloon vanno riletterati senza ricontrollare l'episodio a occhio.

### 10.3 Regole che proteggono il lavoro dell'autore

- **Re-run senza distruzione.** Gli id sono stabili e derivabili (§5.3), quindi rigenerare una scena non sovrascrive le modifiche a mano: le differenze finiscono in una revisione da approvare, con **merge a tre vie** (versione precedente, nuova proposta, versione modificata a mano).
- **Rename globale.** Se il nome di un personaggio cambia a metà serie servono find/replace su testi e riferimenti, non trecento modifiche a mano.
- **Working copy e git.** Il formato a cartella è diffabile, quindi chi vuole può versionare con git (con LFS per `art/`); chi non lo usa ha comunque changelog e revisioni dentro il progetto.
- **La revisione è un dato del progetto, non un servizio esterno**: nessun account, nessun server, funziona anche su una sola macchina.

## 11. Architettura

```
UI (React, nessuna API specifica di piattaforma)
  editor pagina · vista scroll · pannello personaggi · coda render · picker layout · export
        │  comandi tipizzati (undo/redo, autosave)
┌───────▼────────────────────────────────────────────────────────────┐
│ Core (TS puro; unica dipendenza: validatore di schema)              │
│  schema e validate · migrate · resolveLayout · slicing · lettering  │
│  promptCompiler · lint di continuità · renderer SVG · export        │
└───────┬─────────────────────────────┬───────────────────┬───────────┘
        │                             │                   │
┌───────▼─────────┐       ┌───────────▼─────────┐  ┌──────▼──────────┐
│ LlmService      │       │ ImageService        │  │ PlatformService │
│ script → scene  │       │ Mock | fal | Comfy  │  │ fs · dialoghi   │
│ scene → panel   │       │ + RenderQueue       │  │ processi · LFS  │
└─────────────────┘       │ (opzionale, F3+)    │  └─────────────────┘
                          └─────────────────────┘
```

### 11.1 Tre interfacce, non una

La bozza prevedeva solo `ImageService`. Le stesse ragioni valgono per gli altri due lati:

- **`LlmService`** (script → scene → pannelli): serve mockabile per i test offline e sostituibile quando cambiano i fornitori o i modelli. In v1 è centrale perché lo spoglio è una feature del prodotto, ma non è mai cablato nella UI.
- **`PlatformService`** (filesystem, dialoghi, avvio di processi): incapsulandolo, la scelta Tauri/Electron smette di essere irreversibile e una UI web con filesystem virtuale diventa possibile per demo o per il lavoro su una macchina diversa.
- **`ImageService`**: resta un'interfaccia con implementazione mock fin dal primo giorno, ma nel percorso critico di questo target **non è necessaria**: l'arte entra da fuori.

### 11.2 Il Core non sa niente di immagini — e ora è imposto

Il Core prende un documento e restituisce SVG, strutture di export e risultati di lint. Testabile senza GPU, senza rete, in millisecondi. Perché resti vero:

- **policy delle dipendenze**: nel Core è ammesso un solo pacchetto, il validatore di schema (`zod` fa triplo lavoro: tipi TypeScript, validazione a runtime, JSON Schema per il decoding vincolato del modello linguistico);
- **regola di dipendenza verificata dal lint** (import vietati di rete, filesystem e React dentro il Core). "Il Core non sa niente di immagini" oggi sarebbe un'intenzione; con un controllo automatico è un vincolo.

### 11.3 Undo/redo e persistenza

Undo/redo era una feature elencata in F2 senza il modello dati che la sostiene. Qui la decisione:

- **Documento immutabile** e mutazioni solo tramite **comandi tipizzati**; lo stack di undo è fatto di **patch inverse** (`Immer` patches). Vantaggi: testabile headless (una sequenza di comandi produce un documento atteso), undo multlivello, e autosave che riusa gli stessi patch.
- **Scritture atomiche**: scrittura su file temporaneo e rinomina, più un journal di autosave e un lock file. Un crash durante il salvataggio non deve produrre un progetto mutilato.
- **Versionamento dello schema** con catena `migrate(doc)` dall'apertura del file, così i progetti vecchi non si rompono.

### 11.4 Test

| Cosa | Come |
|---|---|
| Renderer SVG | test golden su pagine di prova, output stabile byte per byte |
| Griglia e tiling | property test: qualunque insieme di aree valido tassella la pagina senza buchi |
| Slicing | immagini golden e casi limite (pannello più alto di una slice, pagina con un pannello) |
| Compilatore | snapshot sul `RenderSpec`, incluso l'ordine di precedenza dello stile |
| Lettering | corpus di testi con accenti, parole lunghe, enfasi; nessun sbordo |
| Servizi | integrazione con `ImageService` e `LlmService` finti: nessuna rete nei test |
| Architettura | test che fallisce se il Core importa rete, fs o React |

## 12. Roadmap

Durate in settimane serali (8–10 h/settimana), una persona sola. F3–F5 sono il ramo AI: **opzionale**, da decidere con la v1 già in uso (§14). La numerazione delle fasi AI resta quella della bozza, così i riferimenti in §0, §2 e §3 restano validi.

| Fase | Durata | Contenuto | Criterio d'uscita |
|---|---|---|---|
| **F0** — Formato | 2 sett | Griglia `page` e `strip`, camera nel modello dati, motore di lettering, renderer SVG, export SVG/PNG. Nessuna UI | Una pagina a 6 pannelli scritta a mano, con span, balloon con coda automatica e testo che rifluisce; la stessa pagina resa come striscia verticale; test golden stabile |
| **F0.5** — Ispettore | 0,5 sett | Form di modifica e render SVG live, errori di validazione visibili | Correggi un documento a mano, camera compresa, senza aprire il JSON |
| **F1** — Script → documento | 2–2,5 sett | Spoglio in scene e beat, camera dalla tabella beat→camera, template dal catalogo, id stabili, decoding vincolato, validazione e riparazione, merge dei re-run | Da un capitolo ottieni un documento sensato e valido; rigenerare una scena non perde le modifiche a mano |
| **F2** — Editor | 4–5 sett | Vista pagina e vista scroll, drag dei balloon, gutter trascinabili, merge/split dei pannelli, camera rapida a icone, undo/redo, import arte con sorveglianza della cartella, salvataggio atomico, virtualizzazione | Monti una pagina intera senza toccare il JSON; importi l'arte disegnata fuori e la pagina si aggiorna |
| **F2.1** — Export multi-formato | 2–2,5 sett | Pagina stampa e digitale, striscia con slicing testato, regioni per il guided view, CBZ, specifiche come configurazione | Un episodio intero esce in tre formati dallo stesso documento, senza interventi manuali sull'impaginazione |
| **F2.2** — Revisioni | 1,5–2 sett | Diff dello script e provenienza, export leggibile, import annotato, lista di correzioni, changelog, find/replace, re-lettering selettivo | Applichi una revisione di 12 correzioni toccando solo i balloon coinvolti, in meno di un minuto |
| **F3** — Arte AI su cloud *(opzionale)* | 2–3 sett | `ImageService` su un servizio cloud, IP-Adapter per la coerenza, coda con stima di tempo e spesa, snap dell'aspect ratio | Una pagina con arte generata e personaggi riconoscibili; verifica cieca ≥ 70% "stesso personaggio" |
| **F4** — ComfyUI locale *(opzionale)* | 2 sett | Seconda implementazione di `ImageService`, workflow versionati, rilevamento della GPU, toggle locale/remoto | Stesso `RenderSpec`, risultato equivalente su locale e cloud |
| **F5** — LoRA *(opzionale)* | 3–5 sett | Character sheet, curatela delle immagini buone, training in background, pesi in UI. È la fase più incerta | Coerenza *misurata* migliore di IP-Adapter, non solo "sembra meglio" |
| **F6** — Packaging | aperta | Installer, primo avvio, aggiornamenti; nel ramo AI anche il bundling di ComfyUI e il download dei modelli (6–12 GB) | Un utente non tecnico arriva al primo export da solo |

**v1 utile = F0 → F2.2: 13–16 settimane**, senza nessun modello di immagini.

### 12.1 Perché non c'è più una "fetta verticale" separata

Con il target precedente serviva una prova anticipata dell'arte AI, perché era l'assunzione che nessuna ingegneria poteva salvare. Con questo target **la v1 è già la fetta verticale**: copione → spoglio → pagina → lettering → tre formati esportati. L'unica assunzione non ingegneristica che resta è **la qualità dello spoglio**, ed è verificabile nella gate di F1, alla terza settimana, non alla decima.

### 12.2 Gate decisionali

| Dopo | Verifica | Se non passa |
|---|---|---|
| F0 | Il lettering automatico è credibile su un corpus di pagine di prova | Rinuncia all'auto-placement delle posizioni e passa a posizionamento manuale con balloon che crescono da soli: il prodotto resta valido |
| F1 | Lo spoglio richiede meno correzioni di quante ne servirebbero scrivendo i pannelli a mano | Rivedi il contratto del modello (tabella beat→camera, catalogo template) prima di proseguire su F2 |
| F2.1 | Lo slicing richiede ritocchi manuali su meno del 20% delle pagine | Semplifica: tagli fissi ai gutter invece di inseguire l'automazione |
| F2.2 | Dopo 4–6 settimane di uso reale, l'autore sente il bisogno dell'arte generata | Il ramo AI non si costruisce: la v1 è il prodotto |

### 12.3 Versione ridotta (8 settimane)

Se il tempo stringe: F0, F0.5, F1, un F2 ridotto (un solo target ritoccabile, nessuna vista scroll dedicata) e F2.1 limitato a pagina digitale più CBZ. Fuori: stampa, guided view, slicing, revisioni strutturate, tutto il ramo AI. Resta comunque uno strumento che fa spoglio, lay-out, lettering ed export — cioè la parte che l'autore ripete ogni settimana.

## 13. Rischi

| Rischio | Impatto | Cosa fare |
|---|---|---|
| Il lettering renderizzato male affossa tutto | Alto | Affrontato in F0, prima di ogni altra cosa; dimensione font in unità di pagina e misurazione reale dei glifi (§8) |
| Lo slicing taglia balloon o crea giunzioni visibili | Alto | Politica `avoid`/`prefer` e suite di immagini golden; in v1 niente face detection, bande manuali (§7.2) |
| Il multi-formato diventa N lay-out da mantenere | Alto | Un solo target ritoccabile a mano; gli altri `derived`; `status: tuned` come avviso (§5.4) |
| Bug RTL sottili e diffusi | Medio | `reading_direction` negli algoritmi fin da F0, corpus di test, ribaltamento della UI solo dopo |
| Lo spoglio produce documenti mediocri | Alto | Tabella beat→camera, catalogo template, decoding vincolato, validazione e riparazione, gate in F1 |
| Re-run dello script che cancella le modifiche a mano | Alto | Id stabili non posizionali, provenienza, merge a tre vie (§10.3) |
| Perdita di lavoro per un crash durante il salvataggio | Medio | Scritture atomiche, journal di autosave, lock file (§11.3) |
| Font commerciali e licenze | Medio | Libreria font per progetto con licenza dichiarata; nessun sostituto imposto (§8.4) |
| Specifiche delle piattaforme che cambiano | Medio | Target come dati di configurazione, non codice cablato (§4.3) |
| Prestazioni su 200+ pagine e migliaia di balloon | Medio | Virtualizzazione, miniature in cache, operazioni batch (§12, F2) |
| Concorrenza: Clip Studio fa già balloon, template ed export | Medio | Non vincere sul singolo pezzo: vinci sul documento, sulle revisioni e sul guided view |
| Stima temporale ottimistica di circa due volte | Alto | Roadmap con gate (§12.2) e versione ridotta già definita (§12.3) |
| Coerenza dei personaggi insufficiente anche con IP-Adapter | Basso (solo ramo AI) | Verifica in F3; se non passa, il ramo AI non si costruisce e la v1 resta il prodotto |
| Stacking di più LoRA ingestibile | Basso (solo ramo AI) | Vincolo dichiarato: in v1 un solo personaggio e uno stile per pannello |
| Packaging più costoso del previsto | Basso (solo ramo AI) | Il bundling di ComfyUI e dei modelli riguarda solo F6 del ramo AI |
| Modelli generali che generano pagine coerenti | Medio | Il documento strutturato, le revisioni e la riformattazione sopravvivono comunque |

## 14. Decisioni aperte

### 14.1 Formato canonico **[DA DECIDERE]**

Quale formato è canonico, cioè quello in cui si autora e che determina il lay-out primario della pagina?

*Raccomandazione*: **pagina come canonico, striscia derivata**. La pagina è il formato più vincolato e più strutturato; la striscia è una derivazione verticale di pannelli che possiedi già, con regole di taglio chiare (gutter, balloon). Il verso opposto è sotto-determinato: da una striscia non esiste un criterio non arbitrario per decidere dove spezzare le pagine.

Blocca: dove vivono gli override dei balloon, quale conversione è automatica, quali avvisi mostra l'editor. Non blocca F0 (entrambe le modalità vanno implementate) né F0.5 e F1.

### 14.2 Stile grafico di riferimento **[DA DECIDERE]**

Non blocca nulla fino a F3: nel ramo manuale lo stile è quello dell'autore, e `style.preset` serve solo come promemoria per il ramo AI.

### 14.3 Ore settimanali reali **[DA DECIDERE]**

Determina se la v1 utile è a 13–16 settimane o più. Se sono 4–5 ore a settimana, il piano va dimezzato ancora rispetto a §12.3.

### 14.4 Tauri o Electron **[DA DECIDERE]**

Con `PlatformService` (§11.1) la scelta è reversibile. Tauri costa meno in dimensione e memoria; Electron ha un ecosistema più maturo e resta tutto TypeScript. Nessuna delle due è una decisione urgente.

### 14.5 Hardware disponibile **[DA DECIDERE]**

Riguarda **solo** il ramo AI opzionale (F4). Con questo target il percorso critico non richiede GPU.

### 14.6 Lingua di interfaccia e fumetti **[DA DECIDERE]**

Il lettering è nostro, quindi la lingua dei fumetti è una configurazione (`locale`) e non un problema del modello. La lingua dell'interfaccia va decisa prima di F2: le etichette della camera (§6.1) esistono già in italiano nel piano.

### 14.7 Decisioni chiuse in questa revisione

Chiuse perché costano poco oggi e molto dopo, e perché tutte le alternative sono peggiori:

- Coordinate normalizzate nel documento, pixel solo nel renderer.
- Id stabili e non posizionali per episodi, pagine, pannelli.
- `reading_direction` e `text_direction` separati.
- Enum chiusi per tutto ciò che il compilatore mappa; testo libero solo per il contenuto.
- Prompt derivati con `prompt.override` come eccezione, non viceversa.
- Cache indirizzata per contenuto, staleness calcolata, niente flag `dirty`.
- `art/` (sorgente) separata da `renders/` (derivata).
- Lettering su un layer separato dall'arte, rigenerabile da solo.
- Dimensione del font in unità di pagina.
- `schema: 1` e catena di migrazioni dal primo giorno.
- Undo/redo su comandi tipizzati con patch inverse; scritture atomiche.
- Webtoon scroll e riformattazione **dentro** il perimetro; pubblicazione e collaborazione **fuori**.

### 14.8 Decisioni minori da prendere entro F0

- Font open di partenza per i nuovi progetti (e relativa licenza da dichiarare).
- Se l'unità di lay-out primaria è la pagina o la doppia pagina (`spread_with` esiste già nel formato).
- Estensione della cartella di progetto (`.comic/` è la proposta) e se il progetto debba essere riconoscibile dall'esterno come cartella o come file-compagno.
- Se la UI si ribalta per `reading_direction: rtl` in v1 o solo in seguito (gli algoritmi sono già direction-aware in entrambi i casi).
- Soglie di lint da rendere errori bloccanti e soglie da lasciare come avvisi (Appendice A).

---

## Appendice A — Regole di lint

Livelli: **errore** = blocca il salvataggio o l'export; **avviso** = segnalato, l'autore decide; **info** = suggerimento di qualità.

| Categoria | Regola | Livello |
|---|---|---|
| Camera | Tre o più pannelli consecutivi con lo stesso `shot` | avviso |
| Camera | Nessun cambio di `shot` entro due pannelli | avviso |
| Camera | Pagina senza alcun `LS`, `MLS` o `INSERT` | info |
| Camera | Coppia botta-e-risposta con `axis_side` incoerente (regola dei 180°) | avviso |
| Camera | Jump cut: stesso `shot` + `angle` + setting consecutivi | avviso |
| Camera | `dutch` usato più di due volte nella stessa pagina | info |
| Griglia | Le aree non tassellano la pagina (buco o sovrapposizione non dichiarata) | errore |
| Griglia | Span oltre i limiti delle tracce | errore |
| Griglia | `reading_order` incompleto, duplicato o con id inesistenti | errore |
| Griglia | Meno di 3 o più di 6 pannelli per pagina | info |
| Griglia | Gutter, margini e bleed incoerenti per il target di stampa | errore |
| Balloon | Ancora fuori dall'intervallo `[0,1]` | errore |
| Balloon | Speaker inesistente nel pannello e balloon non `offpanel` | errore |
| Balloon | Testo oltre la soglia di lunghezza utile (indicativa: 220 caratteri) | avviso |
| Balloon | Più di tre balloon nello stesso pannello | info |
| Balloon | Coda che attraversa il testo o esce dal pannello | avviso |
| Balloon | Balloon che precede il suo interlocutore nell'ordine di lettura | info |
| Contenuto | Personaggio presente nella scena ma assente dai balloon o dai pannelli | info |
| Contenuto | `wardrobe` non specificato per un personaggio che ha varianti | avviso |
| Contenuto | Luogo, ora del giorno o luce incoerenti con la scena | avviso |
| Produzione | Pannello senza arte né render (manca l'immagine) | info |
| Produzione | `balloon.rev` più vecchio dell'ultima voce di changelog che lo riguarda | avviso |
| Produzione | Render stale per il target canonico | info |
| Export | Una linea di taglio della striscia attraversa un balloon | **errore** (blocca l'export) |
| Export | Testo sotto la dimensione minima leggibile alla risoluzione del target | **errore** |
| Export | Font richiesto assente dalla libreria del progetto | **errore** |

---

## Appendice B — Catalogo template di pagina

Ogni template è una tupla deterministica `{cols, rows, areas[], reading_order}`. Il modello sceglie da questo catalogo (§7.3); l'editor li propone come miniature.

| Id | Tracce | Espansione | Uso tipico |
|---|---|---|---|
| `splash` | 1×1 | un pannello a tutta pagina | pagina di apertura, momento forte |
| `grid-3x3` | 3×3 | nove pannelli uniformi | ritmo serrato, sequenze di azione |
| `nine-grid-dialogue` | 3×3 | da 4 a 6 aree irregolari | dialoghi fitti, tempi lunghi |
| `classic-6` | 3×3 | sei aree con alternanza 1/3 + 2/3 | pagina di dialogo standard |
| `top-splash-3` | 3×3 | una fascia a tutta larghezza in alto, tre pannelli sotto | apertura di scena con seguito |
| `t-layout` | 3×3 | una fascia alta a tutta larghezza, una colonna alta a destra che scende di due righe, due pannelli a sinistra | pagina con gerarchia di lettura forte (manga) |
| `sidebar-2` | 3×3 | una colonna stretta alta, due pannelli nel resto | reazioni laterali, commento visivo |
| `strip-4` | 1 colonna | quattro pannelli in sequenza verticale | striscia webtoon, oppure pagina di montaggio |

Regole del catalogo:

- `reading_order` è parte del template, non un effetto collaterale del disegno: ogni area dichiara la propria posizione nella sequenza.
- Le aree di un template tassellano sempre la griglia: un template non valido non entra nel catalogo (la validazione di §7.1 lo impedisce).
- Un template può essere applicato a una pagina esistente **preservando le ancore dei balloon** (le coordinate sono normalizzate): è un caso d'uso quotidiano, non un dettaglio.

---

## Appendice C — Specifiche di uscita indicative

Da trattare come **punti di partenza configurabili**, non come verità: le piattaforme cambiano requisiti e i valori devono stare in un file di configurazione aggiornabile (§4.3).

| Target | Parametri | Note |
|---|---|---|
| Pagina digitale | larghezza tipica 1600 px, sRGB, PNG o JPEG di alta qualità | la dimensione minima serve alla leggibilità del lettering: 1500–1600 px di larghezza è un buon compromesso |
| Pagina stampa (manga) | B5 (182×257 mm), 600 dpi, scala di grigi, bleed 3 mm, area sicura rientrata dal taglio | il valore del bleed dipende dallo stampatore: va confermato per ogni fornitore |
| Pagina stampa (albo a colori) | formato e dpi definiti dall'editore | da configurare per progetto |
| Striscia webtoon | larghezza 1080 px, slice verticali da 1280 px, JPEG | le piattaforme impongono anche numero massimo di immagini e peso per episodio: da configurare |
| Guided view | rettangoli normalizzati per pannello, in ordine di lettura | deriva dai box calcolati: nessun lavoro aggiuntivo |
| CBZ | archivio con numerazione di pagina per ordine di lettura | contenitore neutro, utile per consegne e backup |

Tre regole che valgono per tutti i target:

1. **L'ordine di lettura è quello del documento**, non l'ordine di file system: i nomi dei file esportati devono seguire `reading_order`.
2. **La risoluzione si decide alla generazione, non dopo**: un pannello destinato alla stampa va generato (o disegnato) alla dimensione che gli compete, tenendo conto del rapporto del suo box.
3. **Nessun target è speciale nel formato**: aggiungere un formato di uscita significa aggiungere una voce di configurazione, non toccare il codice del Core.
