# comic-builder desktop

L'editor come applicazione desktop (Electron). La UI è la stessa del browser (`packages/ui`); questo pacchetto aggiunge ciò che il browser non sa fare:

- **cartelle vere**: i progetti si aprono e si salvano con il dialogo del sistema, con scritture atomiche, e l'ultimo si riapre da solo all'avvio;
- **rete senza proxy**: le chiamate a FLUX, ai modelli linguistici e al motore locale le fa il processo principale, quindi niente CORS;
- **chiavi API cifrate** nel portachiavi del sistema (Keychain, DPAPI, libsecret);
- **chiusura concordata**: prima di chiudere la finestra si salva ciò che aspettava l'autosave e si rilascia il lucchetto del progetto.

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
