import type { Balloon } from "@comic-builder/core";

interface Props {
  balloon: Balloon;
  onChange: (balloon: Balloon) => void;
}

/**
 * v1: il testo si modifica come un unico run, senza enfasi per-parola —
 * un editor di run ricchi (em: bold|italic|small) resta un affinamento
 * successivo, fuori dallo scopo minimo di F0.5 (§12).
 */
export function BalloonEditor({ balloon, onChange }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");
  const target = balloon.tail.target ?? { x: 0.5, y: 0.5 };

  function setAnchor(axis: "x" | "y", value: number) {
    onChange({ ...balloon, anchor: { ...balloon.anchor, [axis]: value } });
  }

  function setTailTarget(axis: "x" | "y", value: number) {
    onChange({ ...balloon, tail: { ...balloon.tail, target: { ...target, [axis]: value } } });
  }

  return (
    <div className="card">
      <p className="card__title">
        {balloon.id} · {balloon.type}
        {balloon.speaker.ref ? ` · ${balloon.speaker.ref}` : " · fuori campo"}
      </p>

      <div className="stack">
        <label className="field">
          <span className="field__label">testo</span>
          <textarea
            value={plainText}
            rows={2}
            onChange={(e) => onChange({ ...balloon, text: [{ t: e.target.value }] })}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="field">
            <span className="field__label">anchor x</span>
            <input
              type="number"
              step={0.01}
              value={balloon.anchor.x}
              onChange={(e) => setAnchor("x", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field__label">anchor y</span>
            <input
              type="number"
              step={0.01}
              value={balloon.anchor.y}
              onChange={(e) => setAnchor("y", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field__label">coda x</span>
            <input
              type="number"
              step={0.01}
              value={target.x}
              onChange={(e) => setTailTarget("x", Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field__label">coda y</span>
            <input
              type="number"
              step={0.01}
              value={target.y}
              onChange={(e) => setTailTarget("y", Number(e.target.value))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
