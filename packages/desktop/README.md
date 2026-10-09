# comic-builder desktop

L'editor come applicazione desktop (Electron). La UI è la stessa del browser (`packages/ui`); questo pacchetto aggiunge ciò che il browser non sa fare:

- **cartelle vere**: i progetti si aprono e si salvano con il dialogo del sistema, con scritture atomiche, e l'ultimo si riapre da solo all'avvio;
- **rete senza proxy**: le chiamate a FLUX, ai modelli linguistici e al motore locale le fa il processo principale, quindi niente CORS;
- **chiavi API cifrate** nel portachiavi del sistema (Keychain, DPAPI, libsecret);
- **chiusura concordata**: prima di chiudere la finestra si salva ciò che aspettava l'autosave e si rilascia il lucchetto del progetto.

## Modelli locali

Progetto → **Modelli locali…** apre la procedura guidata: guarda cosa c'è nel computer (sistema, RAM, scheda grafica, spazio libero), consiglia cosa installare, scarica e prova. Una sola strategia per spoglio e immagini:

| | motore | modelli |
|---|---|---|
| spoglio | [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | Qwen3.5 4B, Qwen3.5 9B, Gemma 4 12B |
| immagini | [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (`sd-server`) | FLUX.2 [klein] 4B, a 4 o 8 bit |

- I binari sono quelli ufficiali dei due progetti (Metal sul Mac, Vulkan o CPU su Windows e Linux); i modelli sono GGUF da Hugging Face, tutti Apache 2.0 e scaricabili senza login. Versioni e SHA-256 sono fissati in `src/local/catalog.ts`: ogni file si verifica prima di usarlo, e un download interrotto riprende.
- Tutto sta in `userData/local` (motori, modelli, log): niente servizi di sistema, niente permessi di amministratore. «togli i modelli locali» nella procedura cancella quella cartella.
- I motori partono alla prima richiesta, su una porta libera di `127.0.0.1`, e si fermano all'uscita. Spoglio e immagini vanno a turno: avviarne uno ferma l'altro, così non si contendono la memoria della GPU.
- Limiti noti: niente motore delle immagini sui Mac Intel; su Linux il motore delle immagini vuole glibc 2.38 (Ubuntu 24.04 o più recente); la build per il Mac di stable-diffusion.cpp è fatta su macOS 26, e su versioni più vecchie va provata.

Per provare la procedura senza scaricare gigabyte: `COMIC_BUILDER_LOCAL_CATALOG=catalogo.json` (solo fuori dall'app impacchettata) sostituisce motori e modelli con quelli di un catalogo di prova, nella stessa forma di `catalog.ts`.

## Avviarla

```sh
pnpm build                                  # i pacchetti compilati (core, lettering, …) e la UI
pnpm --filter @comic-builder/desktop start  # compila la UI di produzione e apre l'app
```

Per lavorare sulla UI con il ricaricamento a caldo: `pnpm --filter @comic-builder/ui dev` in un terminale, `pnpm --filter @comic-builder/desktop dev` in un altro.

L'app si avvia da `launch.mjs`, che toglie `ELECTRON_RUN_AS_NODE`: i processi nati da VS Code la ereditano, e con quella variabile Electron parte come Node.

In un container senza GPU (Codespaces, devcontainer) servono le librerie di GTK (`sudo apt-get install libgtk-3-0`), un display virtuale e due opzioni: `node launch.mjs --no-sandbox --disable-gpu`.

## Installer

```sh
pnpm --filter @comic-builder/desktop package   # quello del sistema su cui gira: dmg, exe (NSIS) o AppImage
```

Gli installer escono in `packages/desktop/release/`. Per averli tutti e tre senza un Mac e un PC Windows: GitHub → Actions → **desktop** → *Run workflow*, e si scaricano dagli artifact.

Packaging lite: niente firma né notarizzazione (macOS chiede di aprire l'app con il tasto destro → Apri la prima volta, Windows mostra l'avviso di SmartScreen), niente aggiornamenti automatici.
