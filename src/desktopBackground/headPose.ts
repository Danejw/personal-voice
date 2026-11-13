import { PerspectiveCamera, Vector3 } from "three";
import { frameCorners } from "three/addons/utils/CameraUtils.js";
import type { viewSection } from "./layout";

export interface HeadPose { x: number; y: number; z: number }
export interface FaceSample { x: number; y: number; span: number }
export const CENTER: HeadPose = { x: 0, y: 0, z: 0 };
const clamp = (n: number) => Math.max(-1, Math.min(1, n)) || 0;

/** Relative eye midpoint + apparent inter-eye span. Depth is approximate, not metric. */
export function relativePose(sample: FaceSample, neutral: FaceSample, strength: number, reverse: boolean): HeadPose {
  if (![sample.x, sample.y, sample.span, neutral.x, neutral.y, neutral.span, strength].every(Number.isFinite)
    || sample.span <= 0 || neutral.span <= 0) return { ...CENTER };
  const gain = Math.max(0, Math.min(2, strength));
  return {
    x: clamp((sample.x - neutral.x) / neutral.span * gain * (reverse ? 1 : -1)),
    y: clamp(-(sample.y - neutral.y) / neutral.span * gain),
    z: clamp((neutral.span / sample.span - 1) * gain * 0.5),
  };
}

/** One stationary virtual display plane; all monitor frustums share the same moving eye. */
const baseline = new PerspectiveCamera(52, 1, 0.1, 180);
baseline.position.set(0, 8, 24);
baseline.lookAt(0, 0, -30);
export function applyHeadView(camera: PerspectiveCamera, view: ReturnType<typeof viewSection>, pose: HeadPose) {
  const rotation = baseline.quaternion;
  const distance = 24;
  const height = 2 * Math.tan(52 * Math.PI / 360) * distance;
  const width = height * view.fullWidth / view.fullHeight;
  const origin = new Vector3(0, 0, -distance).applyQuaternion(rotation).add(baseline.position);
  const point = (x: number, y: number) => new Vector3(
    (x / view.fullWidth - 0.5) * width,
    (0.5 - y / view.fullHeight) * height, 0,
  ).applyQuaternion(rotation).add(origin);
  camera.position.copy(baseline.position).add(new Vector3(pose.x * 2, pose.y * 1.5, pose.z * 3).applyQuaternion(rotation));
  frameCorners(camera, point(view.x, view.y + view.height), point(view.x + view.width, view.y + view.height), point(view.x, view.y));
  camera.updateMatrixWorld(true);
}
