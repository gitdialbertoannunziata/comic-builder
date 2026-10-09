// Avvia Electron con l'app di questa cartella. Un launcher invece di `electron .` perché i
// processi nati da VS Code (e da altri editor fatti con Electron) ereditano ELECTRON_RUN_AS_NODE=1,
// e con quella variabile Electron parte come Node: il modulo `electron` diventa un percorso e l'app non si apre.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [dirname(fileURLToPath(import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
