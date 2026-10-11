# comic-builder

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
immagini attivi del pannello, non quelli in attesa. In locale lascia terminare
il render attivo e non avvia i successivi pannelli di quel lotto; gli altri
lavori accodati conservano il proprio turno. Lo spoglio gia' avviato non e'
interrompibile. Installazione e rimozione dei modelli richiedono la coda locale
libera e la riservano durante l'operazione.

I parametri sono quelli scelti al clic. I risultati non sostituiscono pagine
o schede modificate nel frattempo. Cambiare progetto o chiudere il pannello
rimuove i relativi lavori in attesa. Le code sono in memoria nella singola
istanza dell'app: ricaricare o chiudere l'app le svuota, senza ripristino
automatico dei lavori. Le code non sostituiscono i limiti e i retry dei provider.
