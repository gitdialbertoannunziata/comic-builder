import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { english, errorText, formatUsd, getLanguage, setLanguage, subscribeLanguage, t, translate, translateMessage } from "./i18n.js";

/** Ogni `t("…")` scritto nel codice dell'interfaccia: il primo argomento, se è un testo fisso. */
function uiStrings(): Array<{ file: string; text: string }> {
  const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const files = (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !/^english/.test(path.basename(file)));
  const found: Array<{ file: string; text: string }> = [];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) found.push({ file, text: JSON.parse(`"${match[1]}"`) as string });
  }
  return found;
}

afterEach(() => setLanguage("it"));

describe("interface language", () => {
  it("keeps every interpolation placeholder in the English catalog", () => {
    const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
    for (const [source, translated] of Object.entries(english)) {
      expect(translated.trim(), source).not.toBe("");
      expect(placeholders(translated), source).toEqual(placeholders(source));
    }
  });

  it("translates English labels and preserves Italian", () => {
    expect(translate("Copione", "en")).toBe("Script");
    expect(translate("Copione", "it")).toBe("Copione");
  });

  it("formats costs in the selected language", () => {
    expect(formatUsd(0.04)).toBe("0,04 $");
    setLanguage("en");
    expect(formatUsd(0.04)).toBe("$0.04");
  });

  it("preserves unknown text and interpolated project content", () => {
    expect(translate("FLUX", "en")).toBe("FLUX");
    expect(translate("{0}: {1}", "en", ["Il faro", 3])).toBe("Il faro: 3");
    expect(translate("{0} {1}", "it", ["{1}"])).toBe("{1} {1}");
  });

  it("notifies subscribers only when the language changes", () => {
    let changes = 0;
    const unsubscribe = subscribeLanguage(() => changes++);
    setLanguage("en");
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(t("Salva")).toBe("Save");
    expect(changes).toBe(1);
    unsubscribe();
    setLanguage("it");
    expect(changes).toBe(1);
  });
});

describe("catalog coverage", () => {
  it("every fixed t() string in the interface has an English translation", () => {
    // Editing an Italian string silently drops its translation: this is where it shows.
    const missing = uiStrings().filter(({ text }) => english[text] === undefined).map(({ file, text }) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });
});

describe("messages from services", () => {
  it("translates by pattern, putting the values back in place", () => {
    setLanguage("en");
    expect(translateMessage("Salvataggio non riuscito: disco pieno")).toBe(translate("Salvataggio non riuscito: {0}", "en", ["disco pieno"]));
    expect(errorText(new Error("Generazione annullata."))).toBe(english["Generazione annullata."]);
    expect(translateMessage("un messaggio che non è nel catalogo")).toBe("un messaggio che non è nel catalogo");
    setLanguage("it");
    expect(translateMessage("Salvataggio non riuscito: disco pieno")).toBe("Salvataggio non riuscito: disco pieno");
  });
});

describe("errors from the services, in English", () => {
  afterEach(() => setLanguage("it"));

  it("the variant with the memory hint wins over the base form", () => {
    setLanguage("en");
    const said = "SamplerCustomAdvanced: CUDA out of memory";
    const message = `Il motore locale non è riuscito a generare: ${said}. Il modello non ci sta nella memoria della GPU: in Progetto → Modelli locali… c'è la variante compatta, o si passa al servizio cloud per le immagini.`;
    const translated = translateMessage(message);
    expect(translated).toContain(said);
    expect(translated).not.toMatch(/memoria|variante/);
  });

  it("strips Electron's IPC wrapper before translating", () => {
    setLanguage("en");
    const wrapped = new Error("Error invoking remote method 'fs:read': Error: Percorso fuori dalle cartelle scelte: /tmp/x");
    expect(errorText(wrapped)).toContain("/tmp/x");
    expect(errorText(wrapped)).not.toMatch(/Percorso|Error invoking/);
  });
});
