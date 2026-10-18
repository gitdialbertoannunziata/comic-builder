# comic-builder

Dal copione in prosa alle tavole di un fumetto: lo spoglio in scene e
vignette con un modello linguistico, l'impaginazione, il lettering e l'arte
generata con FLUX.2 (cloud), un motore locale o ComfyUI. Gira nel browser
o come app desktop (Electron). La specifica è in [`docs/PLAN.md`](docs/PLAN.md),
e i rimandi `§x.y` nel codice puntano lì.

## Avvio rapido

Servono Node 22 e pnpm 10 (`corepack enable` lo attiva dalla versione
dichiarata in `package.json`).

```bash
pnpm install
pnpm build                              # i pacchetti, core per primo: gli altri ne leggono i tipi compilati
pnpm --filter @comic-builder/ui dev     # l'interfaccia su http://localhost:5173
```

Per l'app desktop, e per i modelli locali che installa da sé, vedi
[`packages/desktop/README.md`](packages/desktop/README.md). Le chiavi e gli
indirizzi di sviluppo si mettono in `packages/ui/.env.local`, partendo da
[`packages/ui/.env.example`](packages/ui/.env.example).

## Comandi

| Comando | Cosa fa |
|---|---|
| `pnpm build` | compila tutti i pacchetti e la UI |
| `pnpm test` | i test (Vitest) di tutti i pacchetti |
| `pnpm lint` | ESLint su tutto il repository |
| `pnpm typecheck` | TypeScript, senza emettere |
| `pnpm desktop` | avvia l'app desktop |

La CI (`.github/workflows/ci.yml`) esegue build, lint, typecheck e test a
ogni push su `main` e su ogni pull request. Su Windows due test degli archivi
dei motori richiedono la modalità sviluppatore, per creare link simbolici.

## Struttura

| Pacchetto | Cosa contiene |
|---|---|
| `core` | il dominio, senza I/O: schemi zod del progetto, comandi dell'editor e cronologia, compilazione di prompt e `RenderSpec`, impaginazione, SVG, revisioni, validazione. ESLint vieta qui fs, rete e React. |
| `lettering` | metriche dei font e adattamento del testo nei balloon |
| `llm` | i servizi linguistici (Anthropic, OpenAI, DeepSeek, Ollama, llama-server, finto) e lo spoglio del copione |
| `image` | i servizi di immagini (FLUX.2 da Black Forest Labs o Azure, sd-server locale, ComfyUI, finto) e la coda di render con tentativi e annullamento |
| `export` | rasterizzazione con resvg, per Node |
| `ui` | l'interfaccia React (Vite); nel browser il progetto sta in una cartella scelta con File System Access |
| `desktop` | il processo principale di Electron: cartelle, rete senza CORS, chiavi cifrate, motori locali |

I lavori di generazione passano da uno scheduler con una coda per corsia
(`local`, `online-text`, `online-image`): uno alla volta per corsia, con un
tetto di spesa sul totale di ciò che è in coda.

## Lingua dell'interfaccia

Il selettore nella barra principale permette di scegliere **Italiano** o
**English**. La scelta si applica subito e viene ricordata sul dispositivo.
La lingua dell'interfaccia non cambia copioni, dialoghi, nomi o altri contenuti
del progetto, e non modifica la lingua delle richieste ai modelli.

## Configurazione

Dal menu **Progetto > Configurazione** si impostano i servizi di testo e
immagini, le chiavi API, i modelli e gli indirizzi definiti in
[`packages/ui/.env.example`](packages/ui/.env.example).
Le modifiche si applicano subito e sono condivise con Copione e generazione immagini.

Modelli e indirizzi vengono ricordati sul dispositivo. Nel browser le chiavi
API restano solo nella scheda; nell'app desktop vengono salvate cifrate se
il portachiavi di sistema risulta disponibile.

La configurazione non modifica i file `.env`: in sviluppo `.env.local`
fornisce i valori iniziali, mentre le preferenze salvate di modelli e
indirizzi hanno precedenza. Le chiavi di `.env.local` hanno precedenza
sul portachiavi desktop. In produzione i valori dell'ambiente non vengono letti.

## Code di generazione

I lavori locali (testo, Ollama, immagini, prove e verifiche dei modelli) condividono una
coda. Online ci sono due code indipendenti: testo e immagini, non una per
fornitore. Le tre code possono avanzare contemporaneamente. Un lavoro mantiene
il turno fino alla fine; il motore locale si attiva soltanto quando serve.
I lotti di immagini locali generano una vignetta alla volta.

Puoi inviare piu' lavori dallo stesso pannello, anche dello stesso tipo:
i pulsanti di generazione restano disponibili mentre gli altri lavori
aspettano o sono in esecuzione. Ogni clic aggiunge un lavoro con i parametri
e la destinazione scelti in quel momento; la coda limita l'esecuzione,
non il numero di lavori che puoi accodare.

La barra dei lavori mostra modello, stato e posizione. Un lavoro in attesa
si puo' annullare singolarmente; il comando `ferma` interrompe solo i lavori
immagini attivi del progetto, non quelli in attesa. In locale lascia terminare
il render attivo e non avvia i successivi pannelli di quel lotto; gli altri
lavori accodati conservano il proprio turno. Lo spoglio gia' avviato non e'
interrompibile. Installazione e rimozione dei modelli richiedono la coda locale
libera e la riservano durante l'operazione.

I parametri sono quelli scelti al clic. I risultati non sostituiscono pagine
o schede modificate nel frattempo. Cambiare capitolo, anche passando a uno
vuoto, non annulla i lavori immagini: conservano la pagina di destinazione
originale. Cambiare progetto rimuove i relativi lavori in attesa. Le code sono in memoria nella singola
istanza dell'app: ricaricare o chiudere l'app le svuota, senza ripristino
automatico dei lavori. Le code non sostituiscono i limiti e i retry dei provider.

## ComfyUI

In **Progetto > Configurazione > Immagini** (o in Pagine → Arte → «servizio e
spesa») si può scegliere **ComfyUI**: le immagini le genera il ComfyUI avviato
su questa macchina (di norma `http://127.0.0.1:8188`), coi suoi modelli e i
suoi nodi. Niente si paga e niente esce dal computer; i lavori usano la coda
locale, come gli altri modelli sulla GPU.

Senza un flusso proprio vale quello di partenza: FLUX.2 [klein] 4B
(`flux-2-klein-4b.safetensors`, `qwen_3_4b.safetensors`,
`flux2-vae.safetensors`) con quattro immagini di riferimento. Per usare un
altro modello si incolla un flusso esportato da ComfyUI con **Export (API)**,
scrivendo nei campi i segnaposto `{{prompt}}`, `{{seed}}`, `{{width}}`,
`{{height}}` e `{{image_1}}` … `{{image_N}}` (nei nodi `LoadImage`). Il numero
di segnaposto delle immagini decide quanti riferimenti si allegano; se una
vignetta ne ha meno, i nodi dei posti vuoti si tolgono e la catena dei
`ReferenceLatent` si ricollega da sola.

**Verifica ComfyUI** dice se mancano nodi o file di modello prima di
accodare. Lo spec registra il modello come `comfyui:<file>@<impronta>`:
cambiare il flusso rende «da rigenerare» le vignette fatte col precedente.
Fermare un lavoro lo toglie dalla coda di ComfyUI, o interrompe il render se
e' gia' in corso.

## Preparare i riferimenti

In **Riferimenti** il riquadro «prepara i riferimenti» genera in un solo
lavoro la vista di fronte di ogni personaggio descritto e la tavola di ogni
luogo descritto che non hanno ancora un'immagine. Conviene farlo dopo lo
spoglio e prima delle vignette: ogni vignetta riceve poi quelle immagini, e
facce e stanze restano le stesse da una pagina all'altra. Chi nel frattempo
riceve un'immagine o cambia descrizione viene saltato.
