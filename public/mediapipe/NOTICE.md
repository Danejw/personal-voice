# MediaPipe head tracking assets

The app uses `@mediapipe/tasks-vision` pinned in `package.json`. Its WebAssembly
runtime is copied from that exact installed dependency by
`scripts/prepare-head-tracking.mjs` during dev/build; generated copies are ignored
by Git and lint. No runtime CDN request is required.

Bundled model: Google MediaPipe Face Landmarker, float16 version 1.

- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Size: 3,758,596 bytes
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Upstream: https://github.com/google-ai-edge/mediapipe
- Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- Upstream licensing clarification: https://github.com/google-ai-edge/mediapipe-samples/issues/407

The accompanying `LICENSE` is the upstream MediaPipe Apache 2.0 license. Preserve
upstream license notices when distributing the runtime and model.

Frames and landmarks are transient local processing data. Only bounded, normalized
head movement is relayed to desktop renderers; neither camera images nor landmarks
are saved, uploaded, logged, or supplied to the Assistant.
