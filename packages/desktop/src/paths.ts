import { promises as fs } from "node:fs";
import path from "node:path";

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
  if (!ok) throw new Error(`Percorso fuori dalle cartelle scelte: ${target}`);
  return real;
}
