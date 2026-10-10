import type { KeyboardEvent } from "react";
import { t } from "../i18n.js";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Un conteggio accanto al nome: correzioni aperte, balloon del pannello. */
  badge?: number | undefined;
  title?: string;
}

interface Props<T extends string> {
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

/** Schede: una sola in vista alla volta. Frecce ←/→ per passare dall'una all'altra. */
export function Tabs<T extends string>({ label, items, value, onChange, className }: Props<T>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const index = items.findIndex((item) => item.id === value);
    const next = items[(index + (event.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  }

  return (
    <div className={`tabs${className ? ` ${className}` : ""}`} role="tablist" aria-label={t(label)} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="tab"
          data-tab={item.id}
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          title={item.title === undefined ? undefined : t(item.title)}
          onClick={() => onChange(item.id)}
        >
          {t(item.label)}
          {item.badge !== undefined && item.badge > 0 && <span className="tab__badge">{item.badge}</span>}
        </button>
      ))}
    </div>
  );
}
