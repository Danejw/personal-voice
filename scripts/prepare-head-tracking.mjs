import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { cp, mkdir } from "node:fs/promises";

// WASM belongs to the pinned dependency, not a CDN or a separately versioned copy.
await mkdir("public/mediapipe/wasm", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", { recursive: true });

const modelPath = "public/mediapipe/face_landmarker.task";
const expectedGitBlobSha = "c50c845d113e02ac6e3627b8121db7fb9a35bb4b";
const url = "https://raw.githubusercontent.com/Danejw/personal-voice/4cdf7db5b49530cf05e33f0515af031006864d4e/public/mediapipe/face_landmarker.task";
const gitSha = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
let bytes;
try { bytes = await readFile(modelPath); } catch { /* first build */ }
if (!bytes || gitSha(bytes) !== expectedGitBlobSha) {
  const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Head tracking model download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (gitSha(bytes) !== expectedGitBlobSha) throw new Error("Head tracking model did not match the pinned Git blob SHA");
  const temporary = join("public/mediapipe", "face_landmarker.task.tmp");
  try { await writeFile(temporary, bytes); await rename(temporary, modelPath); }
  finally { await rm(temporary, { force: true }); }
}
