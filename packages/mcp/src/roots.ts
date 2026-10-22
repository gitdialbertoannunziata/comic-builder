import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Le cartelle in cui il server può leggere e scrivere. Un agente esterno non
 * sceglie le cartelle da un dialogo come l'utente nell'app: le dichiara chi
 * configura il server, una volta, e tutto il resto ne resta fuori.
 *
 * `realPath` e `within` sono gli stessi controlli dell'app desktop
 * (`packages/desktop/src/paths.ts`): copiati e non condivisi perché il Core non
 * può usare `fs`, e il server non deve dipendere da Electron.
 */

/**
 * Il percorso vero: i link simbolici risolti fin dove il percorso esiste,
 * il resto (un file ancora da scrivere, una cartella da creare) attaccato
 * così com'è. Senza, un link dentro la cartella del progetto che punta fuori
 * passerebbe il controllo e porterebbe altrove.
 */
export async function realPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  const tail: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...tail.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/** Il percorso vero, se sta dentro una delle cartelle date; altrimenti un errore, mai un accesso. */
export async function within(target: string, roots: readonly string[]): Promise<string> {
  const real = await realPath(target);
  const realRoots = await Promise.all(roots.map((root) => realPath(root)));
  const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  const ok = realRoots.some((root) => {
    const base = root.endsWith(path.sep) ? root : root + path.sep;
    return same(real, root) || same(real.slice(0, base.length), base);
  });
  if (!ok) throw new Error(`Path outside the allowed roots: ${target}`);
  return real;
}

/**
 * Le radici da riga di comando (`--root <dir>`, ripetibile) e da
 * `COMIC_BUILDER_ROOTS` (separate da `path.delimiter`). Senza radici il server
 * non parte: un default come "la cartella corrente" aprirebbe al client
 * qualunque cosa ci sia sotto.
 */
export function parseRoots(argv: readonly string[], env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root requires a directory");
      roots.push(value);
    } else if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
    }
  }
  for (const entry of (env.COMIC_BUILDER_ROOTS ?? "").split(path.delimiter)) {
    if (entry.trim()) roots.push(entry.trim());
  }
  return roots.map((root) => path.resolve(root));
}
