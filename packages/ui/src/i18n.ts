import { english } from "./english.js";

export type Language = "it" | "en";

export { english };

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

export function formatUsd(value: number): string {
  const amount = new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return language === "en" ? `$${amount}` : `${amount} $`;
}