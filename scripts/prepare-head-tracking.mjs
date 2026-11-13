import { cp, mkdir } from "node:fs/promises";

// WASM belongs to the pinned dependency, not a CDN or a separately versioned copy.
await mkdir("public/mediapipe/wasm", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });
