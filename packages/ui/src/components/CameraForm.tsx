import type { Camera } from "@comic-builder/core";
import {
  SHOT_OPTIONS,
  SHOT_LABELS,
  ANGLE_OPTIONS,
  LENS_MM_OPTIONS,
  DOF_OPTIONS,
  LIGHTING_OPTIONS,
  MOOD_OPTIONS,
  MOTION_OPTIONS,
  SUBJECT_PLACEMENT_OPTIONS,
  AXIS_SIDE_OPTIONS,
} from "../cameraOptions.js";

interface Props {
  camera: Camera;
  onChange: (camera: Camera) => void;
}

const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 13 };
const labelStyle: React.CSSProperties = { fontWeight: 600, color: "#444" };

export function CameraForm({ camera, onChange }: Props) {
  function set<K extends keyof Camera>(key: K, value: Camera[K]) {
    onChange({ ...camera, [key]: value });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <label style={fieldStyle}>
        <span style={labelStyle}>shot</span>
        <select value={camera.shot} onChange={(e) => set("shot", e.target.value as Camera["shot"])}>
          {SHOT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s} — {SHOT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>angle</span>
        <select value={camera.angle} onChange={(e) => set("angle", e.target.value as Camera["angle"])}>
          {ANGLE_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>lens_mm</span>
        <select value={camera.lens_mm} onChange={(e) => set("lens_mm", Number(e.target.value) as Camera["lens_mm"])}>
          {LENS_MM_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}mm
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>dof</span>
        <select value={camera.dof} onChange={(e) => set("dof", e.target.value as Camera["dof"])}>
          {DOF_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>lighting</span>
        <select value={camera.lighting} onChange={(e) => set("lighting", e.target.value as Camera["lighting"])}>
          {LIGHTING_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>mood</span>
        <select value={camera.mood} onChange={(e) => set("mood", e.target.value as Camera["mood"])}>
          {MOOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>motion</span>
        <select value={camera.motion} onChange={(e) => set("motion", e.target.value as Camera["motion"])}>
          {MOTION_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>subject_placement</span>
        <select
          value={camera.subject_placement}
          onChange={(e) => set("subject_placement", e.target.value as Camera["subject_placement"])}
        >
          {SUBJECT_PLACEMENT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>axis_side</span>
        <select value={camera.axis_side} onChange={(e) => set("axis_side", e.target.value as Camera["axis_side"])}>
          {AXIS_SIDE_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
