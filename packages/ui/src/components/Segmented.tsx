interface Option<T> {
  value: T;
  label: string;
  /** Testo esteso al passaggio del mouse: le sigle di §6.1 sono compatte ma non ovvie. */
  title?: string;
  /** Stacca visivamente l'opzione dalle precedenti (es. INSERT, che non sta sulla scala delle inquadrature). */
  detached?: boolean;
}

interface Props<T extends string | number> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}

/**
 * Un clic per valore, invece di apri-scorri-scegli di una tendina.
 * §6.2 è esplicito: per chi disegna la camera è la specifica di disegno, e
 * "la UI deve rendere questa modifica rapidissima [...] non un form di dieci campi".
 */
export function Segmented<T extends string | number>({ label, value, options, onChange }: Props<T>) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={"seg" + (option.detached ? " seg--spaced" : "")}
            aria-pressed={option.value === value}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
