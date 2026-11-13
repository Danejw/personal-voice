// Separate HTML entry: never imports App, auth, dictation, or Assistant.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CENTER, type HeadPose } from "./headPose";
import { viewSection, type MonitorRect } from "./layout";
import { createTerrainView } from "./scene";
import { parseWorldConfig, type WorldPalette } from "./worldConfig";

declare global {
  interface Window {
    __PV_BACKGROUND__?: { monitors: MonitorRect[]; index: number; palette?: WorldPalette };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const nativeLayout = window.__PV_BACKGROUND__;
const preview = !nativeLayout && new URLSearchParams(location.search).has("preview");
async function report(error: string | null) {
  if (nativeLayout) await invoke("desktop_background_ready", { error });
  else if (error) document.body.textContent = error;
}

let cleanup: (() => void) | undefined;
try {
  if (!nativeLayout && !preview) throw new Error("Open this view through the desktop-background control, or use ?preview for a scene preview.");
  const scene = createTerrainView(canvas, error => { void report(error); });
  cleanup = scene.dispose;
  scene.setWorld(parseWorldConfig({ kind: "terrain", palette: nativeLayout?.palette ?? "cyan" }));
  let current = { ...CENTER };
  let stale: ReturnType<typeof setTimeout> | undefined;
  function draw() {
    const data = nativeLayout ?? { monitors: [{ x: 0, y: 0, width: innerWidth, height: innerHeight, scale: 1 }], index: 0 };
    scene.render(viewSection(data.monitors, data.index), current);
  }
  function move(pose: HeadPose) {
    if (![pose.x, pose.y, pose.z].every(v => Number.isFinite(v) && Math.abs(v) <= 1)) return;
    // Smoothing happens once in the native relay, so monitors receive identical eyes.
    current = { ...pose };
    // Native pose delivery is already capped by the single tracker. Draw directly:
    // Chromium can suspend rAF for an occluded desktop child on just one monitor.
    draw();
  }
  const unlistenWorld = nativeLayout ? await listen<WorldPalette>("desktop-environment-changed", event => {
    scene.setWorld(parseWorldConfig({ kind: "terrain", palette: event.payload }));
    draw();
  }) : undefined;
  const unlisten = nativeLayout ? await listen<HeadPose>("desktop-head-pose", event => {
    move(event.payload);
    clearTimeout(stale);
    stale = setTimeout(() => move(CENTER), 700);
  }) : undefined;
  draw();
  await report(null);
  const visible = () => { if (!document.hidden) draw(); };
  window.addEventListener("resize", draw);
  document.addEventListener("visibilitychange", visible);
  const dispose = () => {
    clearTimeout(stale); unlisten?.(); unlistenWorld?.();
    window.removeEventListener("resize", draw);
    document.removeEventListener("visibilitychange", visible);
    scene.dispose();
  };
  window.addEventListener("pagehide", dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
} catch (error) {
  cleanup?.();
  await report(String(error));
}
