import type { ReactNode } from "react";
import { usePreference } from "../usePreference.js";

interface Props {
  /** Chiave con cui si ricorda se è aperta. */
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** Una sezione richiudibile, che dopo un F5 si ritrova com'era. */
export function Section({ id, title, defaultOpen = false, className, children }: Props) {
  const [open, setOpen] = usePreference(`section:${id}`, defaultOpen);
  return (
    <details className={`section${className ? ` ${className}` : ""}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="section__title">{title}</summary>
      <div className="section__body">{open && children}</div>
    </details>
  );
}
