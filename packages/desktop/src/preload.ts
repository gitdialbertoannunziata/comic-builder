import { contextBridge, ipcRenderer } from "electron";

/**
 * Ciò che la UI vede dell'applicazione desktop: `window.comicDesktop`. Poche
 * funzioni, ognuna un canale del processo principale; niente Node nel
 * renderer. La forma è descritta, lato UI, in `packages/ui/src/platform/desktop.ts`.
 */
contextBridge.exposeInMainWorld("comicDesktop", {
  platform: process.platform,
  folders: {
    pick: (title?: string) => ipcRenderer.invoke("folder:pick", title),
    known: (folder: string) => ipcRenderer.invoke("folder:known", folder),
  },
  fs: {
    stat: (target: string) => ipcRenderer.invoke("fs:stat", target),
    list: (dir: string) => ipcRenderer.invoke("fs:list", dir),
    read: (target: string) => ipcRenderer.invoke("fs:read", target),
    write: (target: string, data: Uint8Array | string) => ipcRenderer.invoke("fs:write", target, data),
    mkdir: (target: string) => ipcRenderer.invoke("fs:mkdir", target),
    remove: (target: string) => ipcRenderer.invoke("fs:remove", target),
    reveal: (target: string) => ipcRenderer.invoke("shell:reveal", target),
  },
  net: {
    fetch: (id: string, url: string, init: unknown) => ipcRenderer.invoke("net:fetch", id, url, init),
    abort: (id: string) => ipcRenderer.send("net:abort", id),
  },
  app: {
    /** La finestra sta per chiudersi: la UI finisce ciò che deve, poi chiama `closeReady`. Restituisce chi toglie l'ascolto. */
    onCloseRequested: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("app:close-requested", listener);
      return () => ipcRenderer.removeListener("app:close-requested", listener);
    },
    closeReady: () => ipcRenderer.send("app:close-ready"),
  },
  local: {
    overview: () => ipcRenderer.invoke("local:overview"),
    install: (plan: unknown) => ipcRenderer.invoke("local:install", plan),
    cancel: () => ipcRenderer.invoke("local:cancel"),
    start: (kind: string) => ipcRenderer.invoke("local:start", kind),
    stop: (kind: string) => ipcRenderer.invoke("local:stop", kind),
    log: (kind: string) => ipcRenderer.invoke("local:log", kind),
    remove: () => ipcRenderer.invoke("local:remove"),
    /** L'avanzamento dell'installazione. Restituisce chi toglie l'ascolto. */
    onProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: unknown, progress: unknown) => callback(progress);
      ipcRenderer.on("local:progress", listener);
      return () => ipcRenderer.removeListener("local:progress", listener);
    },
  },
  secrets: {
    status: () => ipcRenderer.invoke("secrets:status"),
    get: (name: string) => ipcRenderer.invoke("secrets:get", name),
    set: (name: string, value: string) => ipcRenderer.invoke("secrets:set", name, value),
  },
});
