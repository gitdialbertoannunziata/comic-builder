import type { Balloon } from "@comic-builder/core";

interface Props {
  balloon: Balloon;
  onChange: (balloon: Balloon) => void;
}

const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 13 };
const labelStyle: React.CSSProperties = { fontWeight: 600, color: "#444" };
const rowStyle: React.CSSProperties = { display: "flex", gap: 10 };

/**
 * v1: il testo si modifica come un unico run, senza enfasi per-parola —
 * un editor di run ricchi (em: bold|italic|small) resta un affinamento
 * successivo, fuori dallo scopo minimo di F0.5 (§12).
 */
export function BalloonEditor({ balloon, onChange }: Props) {
  const plainText = balloon.text.map((r) => r.t).join("");

  function setText(t: string) {
    onChange({ ...balloon, text: [{ t }] });
  }

  function setAnchor(axis: "x" | "y", value: number) {
    onChange({ ...balloon, anchor: { ...balloon.anchor, [axis]: value } });
  }

  function setTailTarget(axis: "x" | "y", value: number) {
    const target = balloon.tail.target ?? { x: 0.5, y: 0.5 };
    onChange({ ...balloon, tail: { ...balloon.tail, target: { ...target, [axis]: value } } });
  }

  const target = balloon.tail.target ?? { x: 0.5, y: 0.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid #ddd", borderRadius: 6, padding: 10 }}>
      <label style={fieldStyle}>
        <span style={labelStyle}>testo ({balloon.type})</span>
        <textarea value={plainText} onChange={(e) => setText(e.target.value)} rows={2} />
      </label>

      <div style={rowStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>anchor.x</span>
          <input
            type="number"
            step={0.01}
            value={balloon.anchor.x}
            onChange={(e) => setAnchor("x", Number(e.target.value))}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>anchor.y</span>
          <input
            type="number"
            step={0.01}
            value={balloon.anchor.y}
            onChange={(e) => setAnchor("y", Number(e.target.value))}
          />
        </label>
      </div>

      <div style={rowStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>tail.target.x</span>
          <input type="number" step={0.01} value={target.x} onChange={(e) => setTailTarget("x", Number(e.target.value))} />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>tail.target.y</span>
          <input type="number" step={0.01} value={target.y} onChange={(e) => setTailTarget("y", Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
}
