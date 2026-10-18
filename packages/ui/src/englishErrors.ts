/**
 * I messaggi d'errore e di validazione che nascono fuori dall'interfaccia
 * (servizi di immagini e di testo, Core, processo desktop), in inglese. La
 * chiave è il testo italiano come esce a runtime, con ogni valore al posto
 * di `{0}`, `{1}`… nell'ordine in cui compaiono; `translateMessage` (i18n.ts)
 * li riconosce e prova prima le chiavi più lunghe, così una variante con il
 * consiglio sulla memoria vince sulla forma di base.
 */
export const englishErrors: Record<string, string> = {
  // image
  "La risposta si è interrotta a metà.": "The response was cut off partway through.",
  "Il flusso ComfyUI non è JSON valido: {0}": "The ComfyUI workflow is not valid JSON: {0}",
  "Il flusso ComfyUI dev'essere un oggetto JSON.": "The ComfyUI workflow must be a JSON object.",
  "Questo è il flusso nel formato dell'editor: in ComfyUI esportalo con «Workflow → Export (API)» (o «Save (API)»).":
    "This workflow is in the editor format: in ComfyUI, export it with “Workflow → Export (API)” (or “Save (API)”).",
  "Il nodo «{0}» del flusso ComfyUI non ha class_type e inputs: serve l'esportazione in formato API.":
    "Node “{0}” in the ComfyUI workflow has no class_type and inputs: export the workflow in API format.",
  "I segnaposto delle immagini vanno numerati da 1 senza buchi: manca {{image_{0}}}.":
    "Image placeholders must be numbered from 1 with no gaps: {{image_{0}}} is missing.",
  "Il flusso ComfyUI non contiene {{prompt}}: il testo della vignetta non arriverebbe al modello.":
    "The ComfyUI workflow has no {{prompt}}: the panel text would never reach the model.",
  "Nel flusso ComfyUI non resta un nodo che salvi l'immagine (SaveImage): se dipende da un'immagine di riferimento, rendila facoltativa.":
    "No node that saves the image (SaveImage) is left in the ComfyUI workflow: if it depends on a reference image, make that image optional.",
  "ComfyUI non ha risposto in tempo su {0}.": "ComfyUI did not respond in time at {0}.",
  "ComfyUI non risponde su {0}: è avviato? (python main.py, o l'app ComfyUI Desktop)":
    "ComfyUI is not responding at {0}: is it running? (python main.py, or the ComfyUI Desktop app)",
  "ComfyUI non risponde su {0}: è avviato?": "ComfyUI is not responding at {0}: is it running?",
  "ComfyUI ha rifiutato la richiesta (403): se è avviato con --enable-cors-header o dietro un proxy, controlla che accetti questo indirizzo.":
    "ComfyUI rejected the request (403): if it runs with --enable-cors-header or behind a proxy, check that it accepts this address.",
  "ComfyUI ha rifiutato il flusso (HTTP {0}): {1}. Manca un file di modello in ComfyUI, o il flusso lo chiama con un altro nome: «Verifica ComfyUI» dice quale.":
    "ComfyUI rejected the workflow (HTTP {0}): {1}. A model file is missing in ComfyUI, or the workflow refers to it by another name: “Check ComfyUI” shows which one.",
  "ComfyUI ha rifiutato il flusso (HTTP {0}): {1}": "ComfyUI rejected the workflow (HTTP {0}): {1}",
  "ComfyUI ha rifiutato la richiesta dello stato (HTTP {0}): {1}": "ComfyUI rejected the status request (HTTP {0}): {1}",
  "ComfyUI ha rifiutato l'elenco dei nodi (HTTP {0}): {1}": "ComfyUI rejected the node list request (HTTP {0}): {1}",
  "ComfyUI ha rifiutato il caricamento di un riferimento (HTTP {0}): {1}": "ComfyUI rejected a reference upload (HTTP {0}): {1}",
  "ComfyUI ha rifiutato lo storico (HTTP {0}): {1}": "ComfyUI rejected the history request (HTTP {0}): {1}",
  "Il flusso ComfyUI ha {0} posti per le immagini di riferimento: ne sono arrivate {1}.":
    "The ComfyUI workflow has {0} slots for reference images, but {1} were provided.",
  "ComfyUI ha accettato il flusso senza restituire l'id del lavoro.": "ComfyUI accepted the workflow without returning a job ID.",
  "ComfyUI non ha finito in tempo: la coda è occupata da altro, o il modello non ci sta in memoria.":
    "ComfyUI did not finish in time: the queue is busy with other work, or the model does not fit in memory.",
  "ComfyUI non è riuscito a generare: errore sconosciuto.": "ComfyUI could not generate the image: unknown error.",
  "ComfyUI non è riuscito a generare: {0}. Il modello non ci sta nella memoria della GPU: prova un modello più piccolo, o una risoluzione più bassa.":
    "ComfyUI could not generate the image: {0}. The model does not fit in GPU memory: try a smaller model or a lower resolution.",
  "ComfyUI non è riuscito a generare: {0}.": "ComfyUI could not generate the image: {0}.",
  "ComfyUI ha finito senza immagini: il flusso ha un nodo SaveImage collegato?":
    "ComfyUI finished without any images: does the workflow have a connected SaveImage node?",
  "Download dell'immagine da ComfyUI fallito ({0}).": "Downloading the image from ComfyUI failed ({0}).",
  "Manca la chiave API di Black Forest Labs.": "The Black Forest Labs API key is missing.",
  "Black Forest Labs non ha risposto in tempo.": "Black Forest Labs did not respond in time.",
  "Black Forest Labs non raggiungibile: controlla la connessione.": "Cannot reach Black Forest Labs: check your connection.",
  "FLUX.2 accetta al massimo {0} immagini di riferimento: ne sono arrivate {1}.":
    "FLUX.2 accepts at most {0} reference images, but {1} were provided.",
  "Black Forest Labs ha accettato la richiesta senza dire dove seguirla.":
    "Black Forest Labs accepted the request without saying where to track it.",
  "Black Forest Labs dice che l'immagine è pronta, ma non dà l'indirizzo.":
    "Black Forest Labs says the image is ready, but did not provide its address.",
  "Download dell'immagine fallito ({0}).": "Image download failed ({0}).",
  "Il filtro di sicurezza ha rifiutato il prompt di questa vignetta: riformula l'azione, o usa un prompt tuo.":
    "The safety filter rejected this panel's prompt: rephrase the action, or use your own prompt.",
  "Il filtro di sicurezza ha scartato l'immagine generata: riprova con un'altra variante.":
    "The safety filter discarded the generated image: try again with another variant.",
  "Generazione fallita presso il fornitore{0}": "Generation failed at the provider{0}",
  "Il fornitore non trova più la richiesta.": "The provider can no longer find the request.",
  "Nessun risultato entro il tempo limite: la richiesta è rimasta in coda dal fornitore.":
    "No result within the time limit: the request is still queued at the provider.",
  "Chiave API di Black Forest Labs rifiutata: verificala o creane una nuova.":
    "Black Forest Labs API key rejected: check it or create a new one.",
  "Credito Black Forest Labs esaurito: ricarica il conto per continuare.":
    "Black Forest Labs credit exhausted: top up your account to continue.",
  "Parametri non accettati da FLUX.2: {0}": "Parameters not accepted by FLUX.2: {0}",
  "Troppe richieste insieme a Black Forest Labs: riprovo fra poco.":
    "Too many simultaneous requests to Black Forest Labs: retrying shortly.",
  "Black Forest Labs ha risposto {0}: {1}": "Black Forest Labs responded {0}: {1}",
  "Manca la chiave API della risorsa Azure AI Foundry.": "The API key for the Azure AI Foundry resource is missing.",
  "«{0}» non è un endpoint valido: serve l'indirizzo della risorsa, es. https://nome.services.ai.azure.com":
    "“{0}” is not a valid endpoint: enter the resource address, e.g. https://name.services.ai.azure.com",
  "Azure AI Foundry non ha risposto in tempo.": "Azure AI Foundry did not respond in time.",
  "Azure AI Foundry non raggiungibile: controlla la connessione e l'endpoint.":
    "Cannot reach Azure AI Foundry: check your connection and the endpoint.",
  "Chiave rifiutata da Azure AI Foundry: verifica che sia quella della risorsa indicata nell'endpoint.":
    "Key rejected by Azure AI Foundry: check that it belongs to the resource in the endpoint.",
  "Azure non trova il deployment «{0}»: controlla il nome in Foundry (Modelli + endpoint) e l'endpoint.":
    "Azure cannot find the deployment “{0}”: check its name in Foundry (Models + endpoints) and the endpoint.",
  "Limite di richieste al minuto del deployment raggiunto: aspetto e riprovo.":
    "The deployment's requests-per-minute limit was reached: waiting before retrying.",
  "Richiesta non accettata da FLUX.2: {0}": "Request not accepted by FLUX.2: {0}",
  "Azure AI Foundry ha risposto {0}: {1}": "Azure AI Foundry responded {0}: {1}",
  "Download dell'immagine da Azure non riuscito.": "Could not download the image from Azure.",
  "Azure ha risposto senza immagine: di solito è il filtro di sicurezza. Riformula l'azione della vignetta, o usa un prompt tuo.":
    "Azure responded without an image: this is usually the safety filter. Rephrase the panel's action, or use your own prompt.",
  "Il motore locale non ha risposto in tempo su {0}.": "The local engine did not respond in time at {0}.",
  "Il motore locale non risponde su {0}: è avviato? Il motore ha scritto: {1}":
    "The local engine is not responding at {0}: is it running? The engine's output: {1}",
  "Il motore locale non risponde su {0}: è avviato?": "The local engine is not responding at {0}: is it running?",
  "Il motore locale ha la coda piena: riprovo fra poco.": "The local engine's queue is full: retrying shortly.",
  "Il motore locale ha rifiutato la richiesta delle capacità (HTTP {0}){1}":
    "The local engine rejected the capabilities request (HTTP {0}){1}",
  "Il motore locale ha rifiutato il lavoro (HTTP {0}){1}": "The local engine rejected the job (HTTP {0}){1}",
  "Il motore locale ha rifiutato lo stato del lavoro (HTTP {0}){1}": "The local engine rejected the job status request (HTTP {0}){1}",
  "Il modello locale accetta al massimo {0} immagini di riferimento: ne sono arrivate {1}.":
    "The local model accepts at most {0} reference images, but {1} were provided.",
  "Il motore locale non ha restituito l'id del lavoro.": "The local engine did not return a job ID.",
  "Il motore locale non ha finito in tempo: la GPU è occupata da altro, o il modello non ci sta in memoria. Il motore ha scritto: {0}":
    "The local engine did not finish in time: the GPU is busy with other work, or the model does not fit in memory. The engine's output: {0}",
  "Il motore locale non ha finito in tempo: la GPU è occupata da altro, o il modello non ci sta in memoria.":
    "The local engine did not finish in time: the GPU is busy with other work, or the model does not fit in memory.",
  "Il motore locale ha finito senza restituire un'immagine.": "The local engine finished without returning an image.",
  "Il motore locale non è riuscito a generare: errore sconosciuto.": "The local engine could not generate the image: unknown error.",
  "Il motore locale non è riuscito a generare: {0}. Il motore ha scritto: {1} Il modello non ci sta nella memoria della GPU: in Progetto → Modelli locali… c'è la variante compatta, o si passa al servizio cloud per le immagini.":
    "The local engine could not generate the image: {0}. The engine's output: {1} The model does not fit in GPU memory: choose the compact variant in Project → Local models…, or switch to the cloud image service.",
  "Il motore locale non è riuscito a generare: {0}. Il modello non ci sta nella memoria della GPU: in Progetto → Modelli locali… c'è la variante compatta, o si passa al servizio cloud per le immagini.":
    "The local engine could not generate the image: {0}. The model does not fit in GPU memory: choose the compact variant in Project → Local models…, or switch to the cloud image service.",
  "Il motore locale non è riuscito a generare: {0}. Il motore ha scritto: {1}":
    "The local engine could not generate the image: {0}. The engine's output: {1}",
  "Il motore locale non è riuscito a generare: {0}.": "The local engine could not generate the image: {0}.",

  // llm
  "Richiesta annullata.": "Request cancelled.",
  "Il modello ({0}) non ha finito entro il tempo massimo della richiesta: prova un capitolo più corto, o un modello più veloce.":
    "The model ({0}) did not finish within the request time limit: try a shorter chapter or a faster model.",
  "Il modello ha rifiutato la richiesta{0}. Se il capitolo contiene materiale che fa scattare un filtro, prova lo spoglio locale con Ollama.":
    "The model refused the request{0}. If the chapter contains material that triggers a filter, try the local breakdown with Ollama.",
  "Risposta troncata a {0} token: il capitolo è troppo lungo per una sola richiesta. Spezzalo, o alza il limite.":
    "Response truncated at {0} tokens: the chapter is too long for a single request. Split it, or raise the limit.",
  "La risposta non è stata interpretata secondo lo schema richiesto.": "The response was not parsed according to the requested schema.",
  "Chiave API rifiutata: controlla che sia valida e che non sia scaduta.": "API key rejected: check that it is valid and has not expired.",
  "La chiave non ha accesso a questo modello.": "The key does not have access to this model.",
  "Modello inesistente: controlla il nome.": "Model not found: check the name.",
  "Limite di frequenza raggiunto: riprova fra poco.": "Rate limit reached: try again shortly.",
  "Impossibile raggiungere l'API. Dal browser può essere anche il blocco CORS, non solo la rete.":
    "Cannot reach the API. From the browser this may also be CORS blocking, not just the network.",
  "Errore dell'API{0}: {1}": "API error{0}: {1}",
  "Nessuna implementazione di fetch disponibile": "No fetch implementation available",
  "DeepSeek non raggiungibile su {0}: controlla la connessione.": "Cannot reach DeepSeek at {0}: check your connection.",
  "La risposta di DeepSeek si è interrotta a metà, o non è JSON: riprova.":
    "The DeepSeek response was cut off partway through, or is not JSON: try again.",
  "Risposta troncata: il capitolo produce più testo del limite impostato. Spezzalo, o alza il limite di token.":
    "Response truncated: the chapter produces more text than the configured limit. Split it, or raise the token limit.",
  "DeepSeek ha restituito una risposta vuota. È un comportamento noto del JSON mode: riprova.":
    "DeepSeek returned an empty response. This is a known JSON mode behaviour: try again.",
  "DeepSeek ha risposto con JSON non valido, nonostante il JSON mode.": "DeepSeek responded with invalid JSON, despite JSON mode.",
  "Chiave API di DeepSeek rifiutata: verificala o creane una nuova.": "DeepSeek API key rejected: check it or create a new one.",
  "Credito DeepSeek esaurito: ricarica il conto per continuare.": "DeepSeek credit exhausted: top up your account to continue.",
  "Parametri non accettati da DeepSeek: {0}": "Parameters not accepted by DeepSeek: {0}",
  "Troppe richieste a DeepSeek in poco tempo: riprova fra poco.": "Too many requests to DeepSeek in a short time: try again shortly.",
  "DeepSeek è sovraccarico o ha un problema temporaneo: riprova fra poco.": "DeepSeek is overloaded or has a temporary problem: try again shortly.",
  "DeepSeek ha risposto {0}: {1}": "DeepSeek responded {0}: {1}",
  "Manca l'indirizzo del modello locale.": "The local model address is missing.",
  "Il modello locale non risponde su {0}: è avviato?": "The local model is not responding at {0}: is it running?",
  "Il modello locale ha rifiutato la richiesta (HTTP {0}){1}": "The local model rejected the request (HTTP {0}){1}",
  "Il modello locale non ha finito in tempo: prova un capitolo più corto, o un modello più piccolo.":
    "The local model did not finish in time: try a shorter chapter or a smaller model.",
  "Il modello locale ha interrotto la risposta a metà.": "The local model stopped its response partway through.",
  "Risposta troncata dal limite di token del modello locale: il capitolo va diviso in parti più corte.":
    "Response truncated by the local model's token limit: split the chapter into shorter parts.",
  "Il modello locale non ha restituito una risposta{0}.": "The local model did not return a response{0}.",
  "La risposta del modello locale non è JSON: la grammatica non è stata applicata.":
    "The local model's response is not JSON: the grammar was not applied.",
  "Ollama non raggiungibile su {0}. Due possibilità: non è in esecuzione (`ollama serve`), oppure è attivo ma rifiuta la richiesta di questa pagina — in quel caso riavvialo con `OLLAMA_ORIGINS=*`.":
    "Cannot reach Ollama at {0}. Two possibilities: it is not running (`ollama serve`), or it is running but rejects requests from this page — in that case restart it with `OLLAMA_ORIGINS=*`.",
  "Ollama ha risposto {0}: {1}": "Ollama responded {0}: {1}",
  "La risposta di Ollama si è interrotta a metà.": "The Ollama response was cut off partway through.",
  "Risposta di Ollama troncata dal limite di token (num_predict o contesto del modello).":
    "Ollama response truncated by the token limit (num_predict or the model's context).",
  "Ollama ha risposto senza contenuto": "Ollama responded with no content",
  "Ollama ha risposto con JSON non valido: il modello \"{0}\" potrebbe non supportare l'output vincolato":
    "Ollama responded with invalid JSON: the model “{0}” may not support constrained output",
  "OpenAI non raggiungibile su {0}: controlla la connessione.": "Cannot reach OpenAI at {0}: check your connection.",
  "La risposta di OpenAI si è interrotta a metà, o non è JSON: riprova.":
    "The OpenAI response was cut off partway through, or is not JSON: try again.",
  "OpenAI ha interrotto la risposta{0}. Se il capitolo contiene materiale che fa scattare un filtro, prova lo spoglio locale con Ollama.":
    "OpenAI stopped the response{0}. If the chapter contains material that triggers a filter, try the local breakdown with Ollama.",
  "OpenAI ha risposto con un errore: {0}": "OpenAI responded with an error: {0}",
  "OpenAI ha restituito una risposta vuota: riprova.": "OpenAI returned an empty response: try again.",
  "OpenAI ha risposto con JSON non valido, nonostante lo schema.": "OpenAI responded with invalid JSON, despite the schema.",
  "Richiesta non accettata da OpenAI: {0}": "Request not accepted by OpenAI: {0}",
  "Chiave API di OpenAI rifiutata: verificala o creane una nuova.": "OpenAI API key rejected: check it or create a new one.",
  "La chiave non ha accesso a questo modello, o OpenAI non è disponibile dal tuo paese.":
    "The key does not have access to this model, or OpenAI is not available in your country.",
  "Modello inesistente, o non accessibile con questa chiave: controlla il nome.":
    "Model not found, or not accessible with this key: check the name.",
  "Credito OpenAI esaurito: controlla piano e fatturazione.": "OpenAI credit exhausted: check your plan and billing.",
  "Troppe richieste a OpenAI in poco tempo: riprova fra poco.": "Too many requests to OpenAI in a short time: try again shortly.",
  "OpenAI è sovraccarico o ha un problema temporaneo: riprova fra poco.": "OpenAI is overloaded or has a temporary problem: try again shortly.",
  "OpenAI ha risposto {0}: {1}": "OpenAI responded {0}: {1}",
  "Le descrizioni dei luoghi non sono conformi allo schema: {0}": "The location descriptions do not match the schema: {0}",
  "Righe {0}–{1} fuori dallo script ({2} righe): provenienza scartata": "Lines {0}–{1} are outside the script ({2} lines): source discarded",
  "«{0}» non è un costume di {1}: resta quello di sempre": "“{0}” is not an outfit of {1}: keeping the usual one",
  "\"{0}\" parla in vignetta ma non era fra i presenti del beat: aggiunto": "“{0}” speaks in the panel but was not among the beat's characters: added",
  "\"{0}\" parla ma non era fra i personaggi della scena: aggiunto": "“{0}” speaks but was not among the scene's characters: added",
  "\"{0}\" compare in una vignetta ma non era fra i personaggi della scena: aggiunto":
    "“{0}” appears in a panel but was not among the scene's characters: added",
  "Il piano delle scene non e' conforme allo schema: riprova lo spoglio.": "The scene plan does not match the schema: run the breakdown again.",
  "Il piano delle scene contiene righe mancanti, sovrapposte o fuori dal testo: riprova lo spoglio.":
    "The scene plan has missing, overlapping or out-of-range lines: run the breakdown again.",
  "Il piano delle scene non copre la fine del testo: riprova lo spoglio.": "The scene plan does not cover the end of the text: run the breakdown again.",
  "Righe {0}–{1}: risposta troncata, divise in due richieste": "Lines {0}–{1}: response truncated, split into two requests",
  "Risposta troncata anche su un solo paragrafo (righe da {0}): alza il limite di token del fornitore.":
    "Response truncated even for a single paragraph (lines from {0}): raise the provider's token limit.",
  "Lo spoglio non è conforme allo schema{0}: {1}": "The breakdown does not match the schema{0}: {1}",
  "Lo spoglio della scena contiene riferimenti fuori dalle righe assegnate ({0}–{1}): riprova.":
    "The scene breakdown refers to lines outside the assigned range ({0}–{1}): try again.",

  // core
  "Un salvataggio era stato interrotto: completato all'apertura": "A save had been interrupted: completed on opening",
  "Il capitolo {0} elenca la pagina {1}, ma il file manca": "Chapter {0} lists page {1}, but the file is missing",
  "{0} contiene la pagina {1}": "{0} contains page {1}",
  "La pagina {0} dichiara il capitolo {1}, ma è elencata in {2}": "Page {0} declares chapter {1}, but is listed in {2}",
  "pages/{0} non è elencata in nessun capitolo": "pages/{0} is not listed in any chapter",
  "characters/{0} contiene la scheda di {1}": "characters/{0} contains the sheet for {1}",
  "locations/{0} contiene la scheda di {1}": "locations/{0} contains the sheet for {1}",
  "Salvataggio rifiutato, {0} non è valido: {1}": "Save rejected, {0} is not valid: {1}",
  "{0}: JSON non valido ({1})": "{0}: invalid JSON ({1})",
  "{0}: non conforme allo schema": "{0}: does not match the schema",
  "Nella cartella \"{0}\" non c'è project.json: non è un progetto.": "The folder “{0}” has no project.json: it is not a project.",
  "{0}: non è un oggetto JSON": "{0}: not a JSON object",
  "{0}: campo \"schema\" mancante o non valido": "{0}: “schema” field missing or invalid",
  "{0}: schema {1}, creato da una versione più recente dell'app (questa legge fino a {2})":
    "{0}: schema {1}, created by a newer version of the app (this one reads up to {2})",
  "{0}: manca la migrazione {1} {2}→{3}": "{0}: missing {1} migration {2}→{3}",
  "Capitolo {0} inesistente": "Chapter {0} does not exist",
  "resolvePage richiede una pagina in modalità 'page'; per la modalità 'strip' usa resolveStripFromPage a partire dai box della pagina canonica.":
    "resolvePage requires a page in 'page' mode; for 'strip' mode use resolveStripFromPage starting from the canonical page's boxes.",
  "createZip: archivi oltre 4 GB richiedono ZIP64, non supportato": "createZip: archives over 4 GB require ZIP64, which is not supported",
  "{0}: rev {1}, ma il changelog registra una correzione applicata alla rev {2}": "{0}: rev {1}, but the changelog records a correction applied at rev {2}",
  "1 correzione applicata non è più nel documento ({0}): il loro pannello non esiste più":
    "1 applied correction is no longer in the document ({0}): its panel no longer exists",
  "{0} correzioni applicate non sono più nel documento ({1}): il loro pannello non esiste più":
    "{0} applied corrections are no longer in the document ({1}): their panel no longer exists",
  "{0}: {1} non esiste più": "{0}: {1} no longer exists",
  "Percorso non valido: dev'essere relativo alla cartella del progetto, senza «..»":
    "Invalid path: it must be relative to the project folder, without “..”",
  "La banda deve avere to > from": "The band must have to > from",
  "Impossibile impaginare {0} beat con le dimensioni {1}": "Cannot lay out {0} beats with the sizes {1}",
  "Template \"{0}\" assente dal catalogo": "Template “{0}” is not in the catalogue",
  "Nessun template del catalogo accoglie {0} pannelli: usa paginateBeats per ottenere dimensioni valide":
    "No catalogue template fits {0} panels: use paginateBeats to get valid sizes",
  "{0}: l'arte {1} non è stata trovata": "{0}: artwork {1} was not found",
  "Il progetto non dichiara nessun target pagina.": "The project declares no page target.",
  "\"{0}\" richiede un target pagina come sorgente": "“{0}” requires a page target as its source",
  "\"{0}\" non è un target striscia.": "“{0}” is not a strip target.",
  "Taglio a {0}px attraverso {1}: più alto di una slice, va spostato o ridotto":
    "Cut at {0}px through {1}: taller than a slice, move or shrink it",
  "Taglio a {0}px dentro un pannello (pagina {1}): controlla che non attraversi un volto":
    "Cut at {0}px inside a panel (page {1}): check that it does not cross a face",
  "{0} immagini, la piattaforma ne accetta {1}": "{0} images, the platform accepts {1}",
  "Target \"{0}\" non dichiarato nel progetto.": "Target “{0}” is not declared in the project.",
  "\"{0}\" richiede un target pagina o striscia come sorgente": "“{0}” requires a page or strip target as its source",
  "Manca l'immagine rasterizzata di \"{0}\".": "The rasterised image for “{0}” is missing.",
  "{0}: {1} byte, limite {2}": "{0}: {1} bytes, limit {2}",
  "Episodio di {0} byte, limite {1}": "Episode of {0} bytes, limit {1}",
  "Il progetto non dichiara nessun target pagina: la pagina è il formato canonico (§4.1).":
    "The project declares no page target: the page is the canonical format (§4.1).",
  "Il target \"{0}\" non dichiara né size_px né size_mm con dpi.": "Target “{0}” declares neither size_px nor size_mm with dpi.",
  "Target \"{0}\" dichiarato due volte": "Target “{0}” declared twice",
  "\"{0}\": serve size_px oppure size_mm con dpi": "“{0}”: size_px or size_mm with dpi is required",
  "\"{0}\": bleed e area sicura in mm richiedono dpi": "“{0}”: bleed and safe area in mm require dpi",
  "\"{0}\": l'export esce in RGB; la conversione CMYK va fatta a valle": "“{0}”: the export is RGB; CMYK conversion must be done afterwards",
  "\"{0}\": slice_min_h supera slice_max_h": "“{0}”: slice_min_h exceeds slice_max_h",
  "\"{0}\" deriva da \"{1}\", che non esiste": "“{0}” derives from “{1}”, which does not exist",
  "\"{0}\": le regioni derivano da un target pagina": "“{0}”: regions derive from a page target",
  "\"{0}\": un archivio contiene immagini di un target pagina o striscia": "“{0}”: an archive contains images from a page or strip target",
  "La pagina \"{0}\" non è in modalità 'page': un target pagina si risolve da una griglia.":
    "Page “{0}” is not in 'page' mode: a page target is resolved from a grid.",
  "sliceStrip: minHeight supera maxHeight": "sliceStrip: minHeight exceeds maxHeight",
  "sliceStrip: la finestra [min, max] è più stretta del passo": "sliceStrip: the [min, max] window is narrower than the step",
  "sliceStrip: nessuna sequenza di tagli ammissibile": "sliceStrip: no valid sequence of cuts",
  "Il template \"{0}\" ha {1} aree, ma sono stati passati {2} id di pannello": "Template “{0}” has {1} areas, but {2} panel IDs were given",
  "{0} pannelli consecutivi con lo stesso shot ({1}): {2}": "{0} consecutive panels with the same shot ({1}): {2}",
  "La pagina non ha nessun LS, MLS o INSERT: rischia di essere tutta primi piani":
    "The page has no LS, MLS or INSERT: it risks being all close-ups",
  "Jump cut fra \"{0}\" e \"{1}\": stesso shot, stesso angolo, stesso setting": "Jump cut between “{0}” and “{1}”: same shot, same angle, same setting",
  "Angolo dutch usato {0} volte nella stessa pagina": "Dutch angle used {0} times on the same page",
  "Scambio fra \"{0}\" e \"{1}\" ripreso dallo stesso lato dell'asse ({2}): regola dei 180°":
    "Exchange between “{0}” and “{1}” shot from the same side of the axis ({2}): 180° rule",
  "{0} balloon nello stesso pannello \"{1}\"": "{0} balloons in the same panel “{1}”",
  "Ancora fuori da [0,1]: ({0}, {1})": "Anchor outside [0,1]: ({0}, {1})",
  "Lo speaker \"{0}\" non compare fra i personaggi del pannello: marcalo come offpanel o aggiungilo al pannello":
    "Speaker “{0}” is not among the panel's characters: mark the line as offpanel or add them to the panel",
  "Testo di {0} caratteri, oltre la soglia utile di {1}": "Text of {0} characters, over the practical limit of {1}",
  "{0} pannelli in pagina: fuori dall'intervallo consigliato di 3–6": "{0} panels on the page: outside the recommended range of 3–6",
  "{0} pannelli senza arte né render per \"{1}\": {2}": "{0} panels without artwork or render for “{1}”: {2}",
  "Personaggi della scena assenti da questa pagina: {0}": "Scene characters missing from this page: {0}",
  "{0}: quale costume indossa {1}? ({2})": "{0}: which outfit is {1} wearing? ({2})",
  "{0}: {1} indossa «{2}», che la scheda non conosce ({3})": "{0}: {1} wears “{2}”, which the sheet does not list ({3})",
  "{0} compare in {1} pannelli ma non ha una scheda: il suo aspetto non è definito":
    "{0} appears in {1} panels but has no sheet: their appearance is undefined",
  "Span del pannello \"{0}\" ridotto a {1}x{2} per rientrare nella griglia {3}x{4}":
    "Span of panel “{0}” reduced to {1}x{2} to fit the {3}x{4} grid",
  "Rimosso dall'ordine di lettura un id inesistente: \"{0}\"": "Removed a non-existent ID from the reading order: “{0}”",
  "Rimosso un id duplicato dall'ordine di lettura: \"{0}\"": "Removed a duplicate ID from the reading order: “{0}”",
  "Pannello \"{0}\" accodato all'ordine di lettura": "Panel “{0}” appended to the reading order",
  "Il pannello \"{0}\" ha uno span ({1}x{2} da col={3},row={4}) che eccede la griglia {5}x{6}":
    "Panel “{0}” has a span ({1}x{2} from col={3},row={4}) that exceeds the {5}x{6} grid",
  "Sovrapposizione non dichiarata in col={0},row={1} fra i pannelli: {2} (nessuno dichiara un \"z\" esplicito per l'inset)":
    "Undeclared overlap at col={0},row={1} between panels: {2} (none declares an explicit “z” for the inset)",
  "La griglia ha {0} cella/e non coperte da alcun pannello: {1}": "The grid has {0} cell(s) not covered by any panel: {1}",
  "Id duplicati: {0}": "Duplicate IDs: {0}",
  "Id di pannelli inesistenti: {0}": "Non-existent panel IDs: {0}",
  "Pannelli assenti dall'ordine di lettura: {0}": "Panels missing from the reading order: {0}",
  "Pagina {0} inesistente": "Page {0} does not exist",
  "La pagina {0} non è una pagina a griglia": "Page {0} is not a grid page",
  "La pagina diventerebbe non valida: {0}": "The page would become invalid: {0}",
  "Balloon {0} inesistente nella pagina {1}": "Balloon {0} does not exist on page {1}",
  "Pannello {0} inesistente": "Panel {0} does not exist",
  "Per unire servono due pannelli distinti della pagina": "Merging needs two different panels on the page",
  "Si uniscono solo due pannelli affiancati che insieme formano un rettangolo": "Only two adjacent panels that together form a rectangle can be merged",
  "Il pannello {0} ha già l'arte: unirlo la perderebbe. Scollega prima l'arte.":
    "Panel {0} already has artwork: merging would lose it. Unlink the artwork first.",
  "La pagina {0} non è in nessun capitolo": "Page {0} is not in any chapter",
  "Template {0} inesistente": "Template {0} does not exist",
  "Un balloon non può restare senza testo: per toglierlo, eliminalo": "A balloon cannot be left without text: to remove it, delete it",
  "Il corpo deve essere positivo": "The font size must be positive",
  "Ogni traccia deve avere un peso positivo": "Every track must have a positive weight",
  "Il numero di colonne non cambia trascinando": "Dragging does not change the number of columns",
  "Il numero di righe non cambia trascinando": "Dragging does not change the number of rows",
  "Il gutter non può essere negativo": "The gutter cannot be negative",
  "Un capitolo non può restare senza pagine": "A chapter cannot be left without pages",
  "Correzioni non applicabili: {0}": "Corrections cannot be applied: {0}",
  "Nessuna occorrenza di «{0}» da sostituire": "No occurrences of “{0}” to replace",
  "Il nome nuovo è vuoto": "The new name is empty",
  "Il nome è già quello": "The name is already that",
  "Nessun personaggio «{0}» nel progetto": "No character “{0}” in the project",
  "Esiste già un personaggio «{0}»": "A character “{0}” already exists",
  "«{0}» non è un ref valido: minuscolo, senza spazi né accenti (es. {1})": "“{0}” is not a valid ref: lowercase, no spaces or accents (e.g. {1})",
  "Nessuna scheda per «{0}»": "No sheet for “{0}”",
  "«{0}» non è un ref di luogo valido: minuscolo, senza spazi né accenti (es. {1})":
    "“{0}” is not a valid location ref: lowercase, no spaces or accents (e.g. {1})",
  "Nessuna scheda per il luogo «{0}»": "No sheet for the location “{0}”",
  "Un'opera non può restare senza capitoli": "A project cannot be left without chapters",
  "Le pagine appartengono a un altro capitolo": "The pages belong to another chapter",
  "Nessuna revisione per il capitolo {0}": "No revisions for chapter {0}",
  "Nessuna voce {0}": "No entry {0}",
  "{0} è già decisa: riaprila per cambiarla": "{0} has already been decided: reopen it to change it",
  "Una rimozione non ha un testo da cambiare": "A removal has no text to change",
  "{0} non è applicata": "{0} is not applied",
  "Una battuta tolta non si ripristina da qui: aggiungila di nuovo, o annulla": "A removed line cannot be restored from here: add it again, or undo",
  "Una nota si riapre, non si ripristina": "A note is reopened, not restored",
  "già applicata": "already applied",
  "già rifiutata": "already rejected",
  "il balloon {0} non esiste più": "balloon {0} no longer exists",
  "il pannello {0} non esiste più": "panel {0} no longer exists",
  "manca il balloon": "the balloon is missing",
  "testo nuovo vuoto: per togliere il balloon serve una correzione di rimozione": "new text is empty: removing the balloon needs a removal correction",
  "il testo è cambiato nel frattempo («{0}»)": "the text has changed in the meantime (“{0}”)",
  "l'azione è cambiata nel frattempo": "the action has changed in the meantime",
  "manca il campo da cambiare": "the field to change is missing",
  "«{0}» non è un tipo di battuta": "“{0}” is not a line type",
  "il valore è cambiato nel frattempo («{0}»)": "the value has changed in the meantime (“{0}”)",
  "il balloon non c'è più": "the balloon is no longer there",
  "battuta vuota": "empty line",
  "Il file è del capitolo {0}, non di {1}: controlla di aver scelto quello giusto.":
    "The file is for chapter {0}, not {1}: check that you chose the right one.",
  "Riga {0}: la pagina {1} non esiste in questo capitolo.": "Line {0}: page {1} does not exist in this chapter.",
  "Riga {0}: il pannello [{1}] non esiste in questo capitolo.": "Line {0}: panel [{1}] does not exist in this chapter.",
  "Riga {0}: la battuta [{1}] non esiste in questo capitolo.": "Line {0}: line [{1}] does not exist in this chapter.",
  "Riga {0}: «({1})» non è un tipo di battuta ({2}): il tipo di [{3}] resta com'era.":
    "Line {0}: “({1})” is not a line type ({2}): the type of [{3}] is unchanged.",

  // desktop
  "Richiesta da un'origine non attendibile": "Request from an untrusted origin",
  "Indirizzo non consentito: {0}//{1}": "Address not allowed: {0}//{1}",
  "C'è già un'installazione in corso.": "An installation is already in progress.",
  "Download interrotto: riprendendo, si riparte da dove era arrivato.": "Download interrupted: resuming will continue from where it stopped.",
  "Percorso fuori dalle cartelle scelte: {0}": "Path outside the chosen folders: {0}",
  "Percorso non ammesso nell'archivio: {0}": "Path not allowed in the archive: {0}",
  "Archivio zip non valido: manca la directory centrale.": "Invalid zip archive: the central directory is missing.",
  "Archivio zip non valido: voce della directory centrale rovinata.": "Invalid zip archive: corrupted central directory entry.",
  "Archivio zip con una compressione non gestita ({0}): {1}": "Zip archive with unsupported compression ({0}): {1}",
  "Sui Mac con processore Intel il motore delle immagini non è disponibile.": "The image engine is not available on Intel Macs.",
  "Il motore dello spoglio non ha una versione per questo sistema con questa accelerazione.":
    "The breakdown engine has no version for this system with this acceleration.",
  "Il motore delle immagini non ha una versione per questo sistema con questa accelerazione.":
    "The image engine has no version for this system with this acceleration.",
  "Il motore delle immagini vuole un Linux recente (glibc {0}, come Ubuntu 24.04): qui c'è la {1}.":
    "The image engine needs a recent Linux (glibc {0}, like Ubuntu 24.04): this system has {1}.",
  "Senza una GPU le immagini in locale si possono fare, ma ognuna chiede minuti: meglio il servizio cloud per le immagini.":
    "Without a GPU, local images are possible but each takes minutes: the cloud image service is a better choice.",
  "Lo spoglio sulla CPU funziona, ma un capitolo può chiedere diversi minuti.": "Breakdown on the CPU works, but a chapter can take several minutes.",
  "Con {0} GB per il modello le immagini in locale non ci stanno bene: meglio il servizio cloud.":
    "With {0} GB for the model, local images do not fit well: the cloud service is a better choice.",
  "Download non riuscito (HTTP {0}): {1}": "Download failed (HTTP {0}): {1}",
  "Download senza contenuto: {0}": "Download has no content: {0}",
  "Il file scaricato non è quello atteso (checksum diverso): {0}. Riprova.": "The downloaded file is not the expected one (checksum mismatch): {0}. Try again.",
  "Servono {0} GB e sul disco ne restano {1}: libera spazio e riprova.": "{0} GB are needed and only {1} GB are left on disk: free up space and try again.",
  "Nell'archivio di {0} non c'è {1}.": "The {0} archive does not contain {1}.",
  "Nessuna porta libera": "No free port",
  "I modelli locali per lo spoglio non sono installati: aprili da Progetto → Modelli locali…":
    "The local breakdown models are not installed: set them up from Project → Local models…",
  "I modelli locali per le immagini non sono installati: aprili da Progetto → Modelli locali…":
    "The local image models are not installed: set them up from Project → Local models…",
  "Il motore dello spoglio si è chiuso all'avvio: {0}": "The breakdown engine closed on startup: {0}",
  "Il motore delle immagini si è chiuso all'avvio: {0}": "The image engine closed on startup: {0}",
  "Il motore non è stato pronto in dieci minuti: il modello forse non ci sta in memoria.":
    "The engine was not ready within ten minutes: the model may not fit in memory.",
};
