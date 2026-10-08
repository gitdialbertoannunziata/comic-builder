import type { Camera } from "@comic-builder/core";
import { Segmented } from "./Segmented.js";
import { CAMERA_FIELD_LABELS } from "../labels.js";
import {
  SHOT_OPTIONS,
  SHOT_LABELS,
  ANGLE_OPTIONS,
  ANGLE_LABELS,
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

function plain<T extends string | number>(values: readonly T[]) {
  return values.map((value) => ({ value, label: String(value) }));
}

export function CameraForm({ camera, onChange }: Props) {
  function set<K extends keyof Camera>(key: K, value: Camera[K]) {
    onChange({ ...camera, [key]: value });
  }

  return (
    <div className="stack">
      <Segmented
        label={CAMERA_FIELD_LABELS.shot}
        value={camera.shot}
        onChange={(v) => set("shot", v)}
        options={SHOT_OPTIONS.map((s) => ({
          value: s,
          label: s,
          title: SHOT_LABELS[s],
          // INSERT non sta sulla scala dal campo lunghissimo al primissimo piano:
          // è un'altra cosa, e staccarlo lo dice senza spiegarlo.
          detached: s === "INSERT",
        }))}
      />

      <Segmented
        label={CAMERA_FIELD_LABELS.angle}
        value={camera.angle}
        onChange={(v) => set("angle", v)}
        options={ANGLE_OPTIONS.map((a) => ({ value: a, label: a, title: ANGLE_LABELS[a] }))}
      />

      <Segmented
        label={CAMERA_FIELD_LABELS.lens_mm}
        value={camera.lens_mm}
        onChange={(v) => set("lens_mm", v)}
        options={LENS_MM_OPTIONS.map((l) => ({ value: l, label: `${l}` , title: `${l}mm` }))}
      />

      <Segmented label={CAMERA_FIELD_LABELS.dof} value={camera.dof} onChange={(v) => set("dof", v)} options={plain(DOF_OPTIONS)} />

      <Segmented
        label={CAMERA_FIELD_LABELS.lighting}
        value={camera.lighting}
        onChange={(v) => set("lighting", v)}
        options={plain(LIGHTING_OPTIONS)}
      />

      <Segmented
        label={CAMERA_FIELD_LABELS.motion}
        value={camera.motion}
        onChange={(v) => set("motion", v)}
        options={plain(MOTION_OPTIONS)}
      />

      <Segmented
        label={CAMERA_FIELD_LABELS.subject_placement}
        value={camera.subject_placement}
        onChange={(v) => set("subject_placement", v)}
        options={plain(SUBJECT_PLACEMENT_OPTIONS)}
      />

      {/* mood e axis_side non entrano mai nel prompt (§6.1): il primo governa
          palette e composizione, il secondo serve al lint di continuità.
          Stanno insieme in fondo perché sono metadati, non inquadratura. */}
      <Segmented label={CAMERA_FIELD_LABELS.mood} value={camera.mood} onChange={(v) => set("mood", v)} options={plain(MOOD_OPTIONS)} />

      <Segmented
        label={CAMERA_FIELD_LABELS.axis_side}
        value={camera.axis_side}
        onChange={(v) => set("axis_side", v)}
        options={plain(AXIS_SIDE_OPTIONS)}
      />
    </div>
  );
}
