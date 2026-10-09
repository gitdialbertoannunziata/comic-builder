import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { applyCatalogOverride, type EngineKind } from "./local/catalog.js";
import { install, overview, recentLog, removeAll, start, stop, stopAll, type InstallPlan } from "./local/manager.js";

/**
 * comic-builder come applicazione desktop (§14.4: Electron).
 *
 * La UI è la stessa del browser, senza modifiche di sostanza: ciò che il
 * browser non sa fare — scrivere in una cartella senza chiedere il permesso
 * a ogni avvio, chiamare un'API che non abilita CORS, tenere una chiave fuori
 * dal codice — lo fa questo processo, e il preload glielo espone con poche
 * funzioni (`window.comicDesktop`). Il renderer resta isolato: niente Node,
 * niente `require`, sandbox attivo.
 */

/** La UI compilata (`packages/ui/dist`), servita come `app://ui/…`: un'origine sicura, con fetch e percorsi assoluti che funzionano. */
const SCHEME = "app";
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const devUrl = process.argv.find((a) => a.startsWith("--dev-url="))?.slice("--dev-url=".length) ?? process.env.COMIC_BUILDER_DEV_URL ?? null;
const uiDir = app.isPackaged ? path.join(process.resourcesPath, "ui") : path.resolve(__dirname, "../../ui/dist");
const appOrigin = `${SCHEME}://ui`;

// --- Cartelle dei progetti ---

/**
 * Le cartelle che l'utente ha scelto da un dialogo: il renderer può leggere
 * e scrivere solo lì dentro. Si ricordano fra un avvio e l'altro, perché
 * riaprire l'ultimo progetto non deve richiedere un altro dialogo.
 */
const rootsFile = () => path.join(app.getPath("userData"), "folders.json");
let roots: string[] = [];

async function loadRoots() {
  try {
    roots = (JSON.parse(await fs.readFile(rootsFile(), "utf8")) as string[]).filter((r) => typeof r === "string");
  } catch {
    roots = [];
  }
}

async function grant(folder: string) {
  const resolved = path.resolve(folder);
  if (roots.includes(resolved)) return;
  roots = [...roots, resolved].slice(-50);
  await fs.writeFile(rootsFile(), JSON.stringify(roots, null, 2));
}

/** Il percorso, se sta dentro una cartella concessa; altrimenti un errore, mai un accesso. */
function inside(target: string): string {
  const resolved = path.resolve(target);
  if (!roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))) throw new Error(`Percorso fuori dalle cartelle scelte: ${target}`);
  return resolved;
}

const notFound = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Solo dalla nostra UI: un frame di un'altra origine non parla col processo principale. */
function trusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith(`${appOrigin}/`) || (devUrl !== null && url.startsWith(devUrl));
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error("Richiesta da un'origine non attendibile");
    return fn(...(args as A));
  });
}

function registerFolders() {
  handle("folder:pick", async (title?: string) => {
    const window = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = { title: title ?? "Scegli una cartella", properties: ["openDirectory", "createDirectory"] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const folder = result.canceled ? undefined : result.filePaths[0];
    if (!folder) return null;
    await grant(folder);
    return { path: path.resolve(folder), name: path.basename(folder) };
  });
  handle("folder:known", (folder: string) => roots.includes(path.resolve(folder)));

  handle("fs:stat", async (target: string) => {
    try {
      const stat = await fs.stat(inside(target));
      return { kind: stat.isDirectory() ? "directory" : "file", size: stat.size, lastModified: stat.mtimeMs };
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  });
  handle("fs:list", async (dir: string) => {
    const entries = await fs.readdir(inside(dir), { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      // I file d'appoggio di una scrittura in corso non sono del progetto.
      if (entry.name.includes(".comic-tmp-")) continue;
      if (entry.isDirectory()) out.push({ name: entry.name, kind: "directory" as const });
      else if (entry.isFile()) {
        const stat = await fs.stat(path.join(dir, entry.name));
        out.push({ name: entry.name, kind: "file" as const, size: stat.size, lastModified: stat.mtimeMs });
      }
    }
    return out;
  });
  handle("fs:read", async (target: string) => {
    try {
      return new Uint8Array(await fs.readFile(inside(target)));
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  });
  /** Scrittura atomica (§11.3): file d'appoggio accanto, poi rename. O il file nuovo intero, o quello vecchio intatto. */
  handle("fs:write", async (target: string, data: Uint8Array | string) => {
    const file = inside(target);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.comic-tmp-${randomBytes(4).toString("hex")}`;
    try {
      await fs.writeFile(temp, data);
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  });
  handle("fs:mkdir", async (target: string) => {
    await fs.mkdir(inside(target), { recursive: true });
  });
  handle("fs:remove", async (target: string) => {
    await fs.rm(inside(target), { force: true });
  });
  handle("shell:reveal", (target: string) => shell.showItemInFolder(inside(target)));
}

// --- Rete ---

/**
 * Le chiamate ai fornitori (FLUX, Azure, i modelli linguistici) e al motore
 * locale passano da qui: niente CORS, niente proxy. HTTPS verso chiunque; in
 * chiaro solo verso questa macchina, dove ascoltano Ollama e il motore di immagini.
 */
const inflight = new Map<string, AbortController>();

function allowedUrl(raw: string): URL {
  const url = new URL(raw);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return url;
  throw new Error(`Indirizzo non consentito: ${url.protocol}//${url.host}`);
}

function registerNetwork() {
  handle("net:fetch", async (id: string, raw: string, init: { method?: string; headers?: Array<[string, string]>; body?: string | Uint8Array }) => {
    const controller = new AbortController();
    inflight.set(id, controller);
    try {
      const response = await fetch(allowedUrl(raw), {
        method: init.method ?? "GET",
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : Buffer.from(init.body) } : {}),
        signal: controller.signal,
      });
      return { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()], body: new Uint8Array(await response.arrayBuffer()) };
    } finally {
      inflight.delete(id);
    }
  });
  ipcMain.on("net:abort", (event, id: string) => {
    if (trusted(event)) inflight.get(id)?.abort();
  });
}

// --- Chiavi ---

/**
 * Le chiavi API, cifrate col portachiavi del sistema (Keychain, DPAPI,
 * libsecret). Su Linux senza un portachiavi Electron ripiega su una cifratura
 * di facciata: lo si dice alla UI, che non deve promettere ciò che non c'è.
 */
const secretsFile = () => path.join(app.getPath("userData"), "secrets.json");

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(secretsFile(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function secureStorage(): { available: boolean; backend: string } {
  const available = safeStorage.isEncryptionAvailable();
  const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : process.platform === "darwin" ? "keychain" : "dpapi";
  return { available: available && backend !== "basic_text" && backend !== "unknown", backend };
}

function registerSecrets() {
  handle("secrets:status", () => secureStorage());
  handle("secrets:get", async (name: string) => {
    const stored = (await readSecrets())[name];
    if (!stored || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, "base64"));
    } catch {
      return null;
    }
  });
  handle("secrets:set", async (name: string, value: string) => {
    const secrets = await readSecrets();
    if (!value) delete secrets[name];
    else if (safeStorage.isEncryptionAvailable()) secrets[name] = safeStorage.encryptString(value).toString("base64");
    else return false;
    await fs.writeFile(secretsFile(), JSON.stringify(secrets, null, 2), { mode: 0o600 });
    return true;
  });
}

// --- Finestra ---

/**
 * Chiusura concordata: la finestra non si chiude finché la UI non ha salvato
 * ciò che aspettava l'autosave e rilasciato il lucchetto del progetto. Una
 * scrittura asincrona lanciata mentre la pagina muore non arriva in fondo, e
 * al riavvio il progetto risulterebbe «aperto da un'altra finestra». Se la UI
 * non risponde, dopo qualche secondo si chiude lo stesso: un lucchetto scade,
 * un'app che non si chiude no.
 */
const closing = new WeakSet<BrowserWindow>();

function closeWhenReady(window: BrowserWindow) {
  window.on("close", (event) => {
    if (closing.has(window)) return;
    event.preventDefault();
    window.webContents.send("app:close-requested");
    setTimeout(() => {
      closing.add(window);
      if (!window.isDestroyed()) window.destroy();
    }, 8000);
  });
}

// --- Modelli locali ---

/**
 * La procedura guidata dei modelli locali e i due motori (spoglio e
 * immagini): qui solo i canali, il resto in `local/`. Un'installazione alla
 * volta; l'avanzamento arriva alla finestra che l'ha chiesta.
 */
let installing: AbortController | null = null;

function registerLocal() {
  handle("local:overview", () => overview());
  ipcMain.handle("local:install", async (event, plan: InstallPlan) => {
    if (!trusted(event)) throw new Error("Richiesta da un'origine non attendibile");
    if (installing) throw new Error("C'è già un'installazione in corso.");
    installing = new AbortController();
    try {
      await install(plan, { signal: installing.signal, onProgress: (progress) => event.sender.send("local:progress", progress) });
      return overview();
    } catch (error) {
      if (installing.signal.aborted) throw new Error("Download interrotto: riprendendo, si riparte da dove era arrivato.");
      throw error;
    } finally {
      installing = null;
    }
  });
  handle("local:cancel", () => installing?.abort());
  handle("local:start", (kind: EngineKind) => start(kind));
  handle("local:stop", (kind: EngineKind) => stop(kind));
  handle("local:log", (kind: EngineKind) => recentLog(kind));
  handle("local:remove", async () => {
    installing?.abort();
    await removeAll();
    return overview();
  });
}

function registerLifecycle() {
  ipcMain.on("app:close-ready", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !trusted(event)) return;
    closing.add(window);
    window.close();
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: "comic-builder",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // I link esterni si aprono nel browser, non dentro l'app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${appOrigin}/`) && !(devUrl && url.startsWith(devUrl))) event.preventDefault();
  });
  closeWhenReady(window);
  void window.loadURL(devUrl ?? `${appOrigin}/index.html`);
}

void app.whenReady().then(async () => {
  await loadRoots();
  // Solo in sviluppo: un catalogo di prova (motori e modelli finti, serviti in locale) al posto di quello vero.
  if (!app.isPackaged && process.env.COMIC_BUILDER_LOCAL_CATALOG) applyCatalogOverride(JSON.parse(await fs.readFile(process.env.COMIC_BUILDER_LOCAL_CATALOG, "utf8")));
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.normalize(path.join(uiDir, relative));
    if (!file.startsWith(uiDir + path.sep)) return new Response("Non trovato", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Appunti sì (copia del brief); tutto il resto (fotocamera, notifiche, posizione) no.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "clipboard-sanitized-write"));
  registerFolders();
  registerNetwork();
  registerSecrets();
  registerLifecycle();
  registerLocal();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// I motori locali sono processi figli: non devono sopravvivere all'app.
app.on("before-quit", () => stopAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
