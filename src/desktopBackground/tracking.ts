import { invoke } from "@tauri-apps/api/core";
import { CENTER, relativePose, type FaceSample, type HeadPose } from "./headPose";

const video = document.querySelector<HTMLVideoElement>("#camera")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;
const center = document.querySelector<HTMLButtonElement>("#center")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const strength = document.querySelector<HTMLInputElement>("#strength")!;
const reverse = document.querySelector<HTMLInputElement>("#reverse")!;
let stream: MediaStream | undefined;
let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let neutral: FaceSample | undefined;
let lastSample: FaceSample | undefined;
let generation = 0;

async function send(pose: HeadPose) { await invoke("desktop_head_pose", { pose }); }
function stopCamera(message = "Camera is off. The view has returned to center.") {
  generation++;
  clearTimeout(timer);
  clearTimeout(watchdog);
  worker?.terminate(); worker = undefined;
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  video.srcObject = null;
  neutral = undefined; lastSample = undefined;
  start.disabled = false; stop.disabled = true; center.disabled = true;
  status.textContent = message;
  void send(CENTER).catch(() => {});
}

start.onclick = async () => {
  const current = ++generation;
  start.disabled = true; stop.disabled = false;
  status.textContent = "Opening webcam and loading the local model…";
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (current !== generation) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopCamera("Webcam disconnected. Camera is off."), { once: true });
    video.srcObject = stream;
    await video.play();
    if (current !== generation) return;
    worker = new Worker(new URL("./tracking.worker.ts", import.meta.url), { type: "module" });
    const activeWorker = worker;
    let lastFrame = -1;
    let lastDispatch = 0;
    const frame = async () => {
      if (current !== generation) return;
      if (video.currentTime === lastFrame || video.readyState < 2) { timer = setTimeout(() => { void frame(); }, 40); return; }
      lastFrame = video.currentTime;
      try {
        const bitmap = await createImageBitmap(video);
        if (current !== generation) { bitmap.close(); return; }
        lastDispatch = performance.now();
        activeWorker.postMessage({ type: "frame", bitmap, time: lastDispatch }, [bitmap]);
        watchdog = setTimeout(() => { if (current === generation) stopCamera("Tracker stopped responding. Camera is off; restart to retry."); }, 5000);
      } catch (error) { if (current === generation) stopCamera(`Camera stopped: ${String(error)}`); }
    };
    worker.onmessage = async event => {
      if (current !== generation) return;
      clearTimeout(watchdog);
      if (event.data.type === "error") { stopCamera(`Tracking stopped: ${event.data.error}`); return; }
      if (event.data.type === "ready") { void frame(); return; }
      if (event.data.type === "sample") {
        const sample: FaceSample | null = event.data.sample;
        if (sample && sample.span > 0.01) {
          neutral ??= sample;
          lastSample = sample;
          center.disabled = false;
          status.textContent = "Tracking locally. Move slightly left/right or up/down. Press Center at your normal sitting position.";
        } else { lastSample = undefined; center.disabled = true; status.textContent = "Face not visible. Returning to center…"; }
        try { await send(sample && neutral ? relativePose(sample, neutral, Number(strength.value), reverse.checked) : CENTER); }
        catch (error) { stopCamera(`Background unavailable: ${String(error)}`); return; }
        // Exactly one inference/IPC in flight; never accumulate delayed video frames.
        timer = setTimeout(() => { void frame(); }, Math.max(0, 40 - (performance.now() - lastDispatch)));
      }
    };
    worker.onerror = event => { if (current === generation) stopCamera(`Tracker could not start: ${event.message}`); };
    worker.postMessage({ type: "init", wasm: new URL("/mediapipe/wasm", location.href).href,
      model: new URL("/mediapipe/face_landmarker.task", location.href).href });
    watchdog = setTimeout(() => { if (current === generation) stopCamera("Tracker initialization timed out. Camera is off; restart to retry."); }, 20000);
  } catch (error) { if (current === generation) stopCamera(`Camera unavailable: ${String(error)}`); }
};
stop.onclick = () => stopCamera();
center.onclick = () => { if (lastSample) { neutral = lastSample; void send(CENTER).catch(() => {}); } };
window.addEventListener("pagehide", () => stopCamera(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => stopCamera());

// Opt-in debug runner validates local WASM/model loading without opening a webcam.
if (new URLSearchParams(location.search).has("probe")) {
  start.disabled = true;
  status.textContent = "Testing local MediaPipe model loading; camera remains off…";
  const probe = new Worker(new URL("./tracking.worker.ts", import.meta.url), { type: "module" });
  let finished = false;
  const done = (error: string | null) => {
    if (finished) return;
    finished = true; clearTimeout(timeout); probe.terminate();
    start.disabled = false;
    status.textContent = error ? `Model test failed: ${error}` : "Local model and inference test passed. Camera is off. Click Start camera to track your head.";
    void invoke("desktop_head_probe", { error });
  };
  const timeout = setTimeout(() => done("Model initialization timed out"), 20000);
  probe.onmessage = event => {
    if (event.data.type === "ready") probe.postMessage({ type: "probe" });
    else if (event.data.type === "probe-result") done(null);
    else if (event.data.type === "error") done(event.data.error);
  };
  probe.onerror = event => done(event.message);
  probe.postMessage({ type: "init", wasm: new URL("/mediapipe/wasm", location.href).href,
    model: new URL("/mediapipe/face_landmarker.task", location.href).href });
  window.addEventListener("pagehide", () => { clearTimeout(timeout); probe.terminate(); }, { once: true });
}
