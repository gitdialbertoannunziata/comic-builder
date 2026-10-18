import { english as interfaceStrings } from "./english.js";
import { englishErrors } from "./englishErrors.js";

export type Language = "it" | "en";

/** Il catalogo inglese: le stringhe dell'interfaccia e i messaggi che arrivano dai servizi. */
export const english: Record<string, string> = { ...englishErrors, ...interfaceStrings };

let language: Language = "it";
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return language;
}

export function setLanguage(value: Language): void {
  if (value === language) return;
  language = value;
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function translate(text: string, locale: Language, values: readonly unknown[] = []): string {
  const template = locale === "en" ? english[text] ?? text : text;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}

export function t(text: string, ...values: unknown[]): string {
  return translate(text, language, values);
}

/** I modelli con segnaposto, dal più lungo: vince il più specifico. Si costruiscono una volta. */
interface MessagePattern {
  regex: RegExp;
  english: string;
  /** Il numero di segnaposto di ogni gruppo catturato, nell'ordine in cui compaiono. */
  order: number[];
}
let patterns: MessagePattern[] | null = null;

function messagePatterns(): MessagePattern[] {
  patterns ??= Object.entries(english)
    .filter(([source]) => /\{\d+\}/.test(source) && source.replace(/\{\d+\}/g, "").trim().length >= 8)
    .sort(([a], [b]) => b.length - a.length)
    .map(([source, target]) => {
      const order: number[] = [];
      const body = source
        .split(/(\{\d+\})/)
        .map((part) => {
          const slot = /^\{(\d+)\}$/.exec(part);
          if (!slot) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          order.push(Number(slot[1]));
          return "([\\s\\S]*?)";
        })
        .join("");
      return { regex: new RegExp(`^${body}$`), english: target, order };
    });
  return patterns;
}

/**
 * Un messaggio che non nasce da `t()`: gli errori dei servizi, del Core,
 * del processo desktop. Sono scritti in italiano con i valori già dentro;
 * qui si riconosce il modello da cui vengono e si rimettono i valori nella
 * frase inglese. Un messaggio che non corrisponde a niente resta com'è.
 */
export function translateMessage(text: string, locale: Language = language): string {
  if (locale !== "en") return text;
  const exact = english[text];
  if (exact !== undefined) return exact;
  for (const pattern of messagePatterns()) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const values: string[] = [];
    pattern.order.forEach((slot, i) => (values[slot] = match[i + 1] ?? ""));
    return pattern.english.replace(/\{(\d+)\}/g, (all, index: string) => values[Number(index)] ?? all);
  }
  return text;
}

/** Il testo da mostrare per un errore, nella lingua dell'interfaccia. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Un errore del processo desktop arriva incartato da Electron: la parte da mostrare è quella dopo.
  return translateMessage(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
}

export function formatUsd(value: number): string {
  const amount = new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return language === "en" ? `$${amount}` : `${amount} $`;
}