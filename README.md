# comic-builder

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
