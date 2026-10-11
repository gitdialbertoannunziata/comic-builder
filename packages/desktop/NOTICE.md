# NOTICE — componenti di terze parti

comic-builder è software proprietario (vedi il file `LICENSE` nella radice del
progetto). Le componenti elencate qui sotto restano sotto le rispettive licenze,
che si riportano per intero nei file di licenza di ciascun progetto.

## Inclusi nel pacchetto dell'applicazione

| Componente | Licenza | Uso |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | Il contenitore dell'applicazione desktop |
| [Chromium](https://www.chromium.org/) | BSD-3-Clause e altre | Motore web incluso in Electron (elenco completo in `LICENSES.chromium.html`, distribuito con Electron) |
| [Node.js](https://nodejs.org/) | MIT | Runtime incluso in Electron |
| [React](https://react.dev/) e React DOM | MIT | Interfaccia |
| [zod](https://github.com/colinhacks/zod) | MIT | Validazione dello schema di progetto |
| [zod-to-json-schema](https://github.com/StefanTerdell/zod-to-json-schema) | MIT | Schema per il JSON mode dei modelli linguistici |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | MIT | Client Anthropic |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Export PDF (include pako, MIT/Zlib; tslib, 0BSD) |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | Misurazione dei glifi per il lettering |
| [Comic Neue](https://github.com/crozynski/comicneue) | SIL OFL 1.1 | Font di partenza dei nuovi progetti — vedi `packages/lettering/assets/fonts/NOTICE.md` e `OFL.txt` |

## Scaricati dall'applicazione, su richiesta dell'utente (non inclusi)

I motori e i modelli dei «Modelli locali» non sono dentro il pacchetto: l'app li
scarica, ne verifica il SHA-256 (`packages/desktop/src/local/catalog.ts`) e li
esegue dal proprio computer. Restano di chi li pubblica.

| Componente | Licenza |
|---|---|
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | MIT |
| [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) (`sd-server`) | MIT |
| [Qwen3.5 4B / 9B](https://huggingface.co/unsloth) (GGUF) | Apache-2.0 |
| [FLUX.2 \[klein\] 4B](https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF) e il VAE di FLUX.2 | Apache-2.0 |
| [Gemma 4 12B](https://ai.google.dev/gemma/terms) (GGUF) | **Gemma Terms of Use** (non Apache-2.0) |

> Nota: i modelli non sono tutti Apache-2.0. Qwen3.5, FLUX.2 \[klein\] e il VAE
> sono Apache-2.0; Gemma 4 è distribuito da Google sotto i *Gemma Terms of Use*,
> con i propri obblighi di attribuzione e uso. La procedura guidata mostra la
> licenza di ciascun modello al momento della scelta.

## Solo per lo sviluppo e la compilazione (non distribuiti)

TypeScript, Vite, Vitest, ESLint, Prettier, electron-builder (tutti MIT) e
[@resvg/resvg-js](https://github.com/thx/resvg-js) (MPL-2.0, usato dal pacchetto
`export` per rasterizzare l'SVG, non incluso nell'app desktop).
