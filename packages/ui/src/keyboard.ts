import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Tastiera. Ogni area dichiara le sue scorciatoie come dati (`Shortcut`): da
 * lì vengono sia il comportamento sia la legenda (`?`), che così non possono
 * raccontare due cose diverse.
 *
 * Tre regole valgono per tutte:
 *  - mentre si scrive in un campo le lettere sono testo: `Esc` esce dal
 *    campo, e da lì in poi i tasti sono comandi;
 *  - chi ha già usato il tasto vince (`defaultPrevented`): le schede con le
 *    loro frecce, un elenco con le sue;
 *  - niente che il browser si tenga per sé (Ctrl+numero, Alt+numero su
 *    Linux, F5): una scorciatoia che funziona solo su alcuni sistemi non è
 *    una scorciatoia.
 */
export interface Shortcut {
  /** Combinazioni, come le scrive `combos`: "PageDown", "Shift+ArrowLeft", "Alt+ArrowUp", "n", "?". Più d'una: sinonimi. */
  keys: readonly string[];
  /** Cosa fa, per la legenda. Senza, non compare (sinonimi, protezioni). */
  label?: string;
  /** Come si mostra in legenda, se elencare `keys` non basta: "← ↑ → ↓". */
  shown?: string;
  /** Senza `run` la voce è solo di legenda: il tasto lo gestisce qualcun altro. Se restituisce false il tasto non è stato usato, e prosegue. */
  run?: (event: KeyboardEvent) => void | false;
  /**
   * Quando vale. Di norma fuori dai campi di testo. "always": anche mentre si
   * scrive. "free": solo se il focus non è su un controllo (è sulla pagina o
   * sulla tela) — per i tasti che i controlli usano già: Invio, Tab, Canc.
   */
  when?: "always" | "free";
  /** Tenere premuto non lo ripete: per ciò che crea o elimina. */
  once?: boolean;
}

/** Vero se il tasto finirebbe in un campo: lì scrive, sceglie o cambia un valore. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "button", "file"].includes(target.type);
}

/** La tela su cui valgono i tasti dell'area Pagine: l'elemento con `data-keys="canvas"`. */
export function focusCanvas(): boolean {
  const canvas = document.querySelector<HTMLElement>('[data-keys="canvas"]');
  if (!canvas || canvas.closest("[hidden]")) return false;
  canvas.focus({ preventScroll: true });
  return true;
}

function focusIsFree(): boolean {
  const el = document.activeElement;
  return !el || el === document.body || (el instanceof HTMLElement && el.dataset.keys === "canvas");
}

/** Come si chiama ciò che è stato premuto. Più nomi quando lo stesso simbolo si ottiene in modi diversi. */
export function combos(event: KeyboardEvent): string[] {
  const mods = `${event.ctrlKey || event.metaKey ? "Mod+" : ""}${event.altKey ? "Alt+" : ""}`;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const out = [`${mods}${event.shiftKey ? "Shift+" : ""}${key}`];
  // Un simbolo vuole Shift su una tastiera e non su un'altra («?» è Shift+' in Italia, Shift+/ altrove): conta il simbolo.
  if (event.shiftKey && event.key.length === 1 && !/[a-z0-9]/i.test(event.key)) out.push(`${mods}${key}`);
  return out;
}

/** Passa il tasto alla prima scorciatoia che lo vuole. Vero se qualcuna l'ha usato. */
export function dispatch(event: KeyboardEvent, shortcuts: readonly Shortcut[]): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const pressed = combos(event);
  const typing = isTyping(event.target);
  for (const shortcut of shortcuts) {
    if (!shortcut.run || !shortcut.keys.some((k) => pressed.includes(k))) continue;
    if (typing && shortcut.when !== "always") continue;
    if (shortcut.when === "free" && !focusIsFree()) continue;
    if (!(shortcut.once && event.repeat) && shortcut.run(event) === false) continue;
    event.preventDefault();
    return true;
  }
  return false;
}

// --- Legenda ---

export interface LegendGroup {
  title: string;
  order: number;
  shortcuts: readonly Shortcut[];
}

const legend = new Map<string, LegendGroup>();
const listeners = new Set<() => void>();
let snapshot: readonly LegendGroup[] = [];

function publish() {
  snapshot = [...legend.values()].sort((a, b) => a.order - b.order);
  listeners.forEach((listener) => listener());
}

/** I gruppi di scorciatoie dichiarati da ciò che è montato, nell'ordine in cui si leggono. */
export function useLegendGroups(): readonly LegendGroup[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Dichiara un gruppo di scorciatoie nella legenda, finché il componente è montato. */
export function useLegend(title: string, order: number, shortcuts: readonly Shortcut[]): void {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  useEffect(() => {
    legend.set(title, {
      title,
      order,
      // Le etichette si leggono quando la legenda si apre: sono quelle dell'ultimo render.
      get shortcuts() {
        return latest.current;
      },
    });
    publish();
    return () => {
      legend.delete(title);
      publish();
    };
  }, [title, order]);
}

/**
 * Scorciatoie che valgono su tutta la finestra finché `enabled`, e la loro
 * voce in legenda. Le funzioni sono quelle dell'ultimo render: possono
 * leggere lo stato senza che l'ascoltatore si riattacchi a ogni tasto.
 */
export function useShortcuts(title: string, order: number, shortcuts: readonly Shortcut[], enabled = true): void {
  useLegend(title, order, shortcuts);
  const latest = useRef({ shortcuts, enabled });
  latest.current = { shortcuts, enabled };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!latest.current.enabled) return;
      // Una finestra aperta sopra (la legenda) si tiene i suoi tasti.
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      dispatch(event, latest.current.shortcuts);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// --- Elenchi ---

/**
 * Frecce dentro un elenco di voci (`data-item`): il focus passa alla voce
 * vicina, che si sceglie come con un clic. Va col `tabIndex` a giro — solo
 * la voce scelta sta nel percorso del Tab — così un capitolo di trenta pagine
 * non sono trenta fermate. Vero se il tasto era per l'elenco.
 */
export function listArrows(event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const steps: Record<string, number | undefined> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -Infinity, End: Infinity };
  const step = steps[event.key];
  if (step === undefined) return false;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-item]")];
  const index = items.findIndex((item) => item.contains(document.activeElement));
  if (index < 0) return false;
  event.preventDefault();
  const next = items[Math.max(0, Math.min(items.length - 1, index + step))];
  if (next && next !== items[index]) {
    next.focus();
    next.click();
  }
  return true;
}

/** Dopo che un comando ha riordinato o tolto delle voci, il focus torna su quella scelta. */
export function refocus(container: HTMLElement | null, selector: string): void {
  requestAnimationFrame(() => container?.querySelector<HTMLElement>(selector)?.focus());
}

/** Le scorciatoie degli elenchi, per la legenda: le applicano `listArrows` e gli elenchi che si riordinano. */
export const LIST_LEGEND: readonly Shortcut[] = [
  { keys: ["ArrowUp", "ArrowDown"], shown: "← ↑ → ↓", label: "Voce vicina: capitolo, pagina, vignetta" },
  { keys: ["Alt+ArrowUp", "Alt+ArrowDown"], shown: "Alt + frecce", label: "Sposta il capitolo o la pagina" },
  { keys: ["Delete"], label: "Elimina il capitolo o la pagina" },
];

// --- Come si mostrano i tasti ---

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const KEY_NAMES: Record<string, string> = {
  Mod: isMac ? "⌘" : "Ctrl",
  Alt: isMac ? "⌥" : "Alt",
  Shift: "Shift",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "Pag↑",
  PageDown: "Pag↓",
  Home: "Home",
  End: "Fine",
  Escape: "Esc",
  Enter: "Invio",
  Delete: "Canc",
  Tab: "Tab",
};

/** I tasti di una combinazione, uno per uno: "Shift+PageDown" → ["Shift", "Pag↓"]. */
export function keyCaps(keys: string): string[] {
  // «+» è anche un tasto: in fondo alla combinazione non separa niente.
  const parts = keys === "+" ? ["+"] : keys.endsWith("++") ? [...keys.slice(0, -2).split("+"), "+"] : keys.split("+");
  return parts.map((part) => KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}
