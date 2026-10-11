# Informativa sulla privacy — comic-builder

Ultimo aggiornamento: 11 novembre 2026.

comic-builder è un'applicazione che gira sul tuo computer. Questa informativa
spiega quali dati escono dal dispositivo e quali no. Vale per l'app desktop
(Windows, macOS, Linux) e per la versione nel browser.

## In una riga

L'app non ha telemetria, non ha account e non ha un server proprio: gli unici
dati che escono dalla tua macchina sono quelli che invii tu a un fornitore di
servizi **che scegli tu**, e i file che l'app scarica pubblicamente per te.

## Cosa resta sul tuo dispositivo

- **I tuoi progetti.** Copioni, pagine, vignette, immagini: restano nelle
  cartelle che apri tu, sul tuo disco.
- **Le preferenze.** Lingua, servizio scelto, modelli: restano sul dispositivo.
- **Le chiavi API.** Nel browser restano solo nella scheda e non vengono
  salvate. Nell'app desktop sono cifrate con il portachiavi del sistema
  (Keychain su macOS, DPAPI su Windows, libsecret su Linux); se il sistema non
  offre un portachiavi, l'app te lo dice e la chiave non viene scritta.
- **I log dei motori locali.** Restano nella cartella dati dell'app.

L'app **non** raccoglie statistiche d'uso, **non** invia crash report, **non**
profilazione, **non** pubblicità.

## Cosa esce dal dispositivo

### 1. Testo inviato al fornitore che scegli

Per lo «spoglio» del copione e per generare le immagini, l'app invia i testi
(il copione, le descrizioni, i prompt) al servizio che hai configurato in
**Progetto → Configurazione**. A seconda della tua scelta può essere Anthropic,
OpenAI, DeepSeek, Google (Gemini), un'istanza Ollama con un indirizzo indicato
da te, oppure Azure AI Foundry / Black Forest Labs per le immagini.

Quei dati sono trattati dal fornitore secondo la **sua** informativa e i suoi
termini. Non passano da un server di comic-builder: la chiamata va dalla tua
macchina direttamente al fornitore, con la chiave che hai inserito. Se scegli
**Simulato** non esce nulla. Se usi i **modelli locali**, l'elaborazione avviene
sul tuo computer.

### 2. Download di motori e modelli (solo «Modelli locali», su tua richiesta)

La procedura guidata scarica i binari dei motori da GitHub (llama.cpp,
stable-diffusion.cpp) e i modelli GGUF da Hugging Face. Sono richieste HTTP
normali verso quei siti, che vedono il tuo indirizzo IP come qualsiasi download.
I file sono verificati con un checksum SHA-256 prima dell'uso.

### 3. Link esterni

Se apri un link esterno, si apre nel tuo browser e valgono le regole del sito.

## Cosa non facciamo

- Nessun account, nessun accesso, nessuna email richiesta.
- Nessun dato personale raccolto o conservato da noi.
- Nessuna analytics nell'app o nel sito.
- Nessun tracciamento fra sessioni.

## Minori

L'app non è rivolta a minori di 13 anni e non raccoglie i loro dati.

## Modifiche

Se questa informativa cambia, la data in cima cambia con essa. Le modifiche
sostanziali saranno indicate nelle note di rilascio.

## Contatti

Per domande sulla privacy: apri una segnalazione su
<https://github.com/gitdialbertoannunziata/comic-builder/issues>.

---

# Privacy policy — comic-builder

Last updated: 11 November 2026.

comic-builder runs on your own computer. This policy explains what leaves your
device and what does not. It covers the desktop app (Windows, macOS, Linux) and
the browser version.

## In one line

The app has no telemetry, no accounts, and no server of its own: the only data
that leaves your machine is what you send to a service provider **you choose**,
and the files the app publicly downloads for you.

## What stays on your device

- **Your projects.** Scripts, pages, panels, images: they stay in the folders
  you open, on your disk.
- **Your preferences.** Language, chosen service, models: they stay on the device.
- **API keys.** In the browser they stay only in the tab and are not saved. In
  the desktop app they are encrypted with the system keychain (Keychain on
  macOS, DPAPI on Windows, libsecret on Linux); if the system offers no
  keychain, the app tells you and the key is not written.
- **Local engine logs.** They stay in the app's data folder.

The app collects **no** usage statistics, sends **no** crash reports, performs
**no** profiling, and shows **no** advertising.

## What leaves your device

### 1. Text sent to the provider you choose

For script breakdown and image generation, the app sends your text (the script,
descriptions, prompts) to the service you configured under **Project →
Configuration**. Depending on your choice this may be Anthropic, OpenAI,
DeepSeek, Google (Gemini), an Ollama instance at an address you set, or Azure AI
Foundry / Black Forest Labs for images.

That data is handled by the provider under **their** policy and terms. It does
not pass through a comic-builder server: the call goes from your machine
directly to the provider, with the key you entered. If you choose **Simulated**,
nothing leaves. If you use **local models**, processing happens on your computer.

### 2. Downloading engines and models (only "Local models", at your request)

The wizard downloads engine binaries from GitHub (llama.cpp,
stable-diffusion.cpp) and GGUF models from Hugging Face. These are ordinary HTTP
requests to those sites, which see your IP address like any download. Files are
verified with a SHA-256 checksum before use.

### 3. External links

Opening an external link opens your browser, and that site's rules apply.

## What we do not do

- No accounts, no sign-in, no email required.
- No personal data collected or stored by us.
- No analytics in the app or the website.
- No cross-session tracking.

## Children

The app is not directed to children under 13 and does not collect their data.

## Changes

If this policy changes, the date at the top changes with it. Material changes
will be noted in the release notes.

## Contact

For privacy questions: open an issue at
<https://github.com/gitdialbertoannunziata/comic-builder/issues>.
