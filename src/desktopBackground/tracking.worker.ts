import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let tracker: FaceLandmarker | undefined;
self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const files = await FilesetResolver.forVisionTasks(message.wasm);
      // The classic loader's top-level `var ModuleFactory` is module-scoped when
      // imported from a module worker. Use the package's ES-module loader, which
      // explicitly publishes its factory, paired with its matching WASM binary.
      files.wasmLoaderPath = `${message.wasm}/vision_wasm_module_internal.js`;
      files.wasmBinaryPath = `${message.wasm}/vision_wasm_module_internal.wasm`;
      tracker = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: message.model, delegate: "CPU" },
        runningMode: "VIDEO", numFaces: 1,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: "ready" });
    } else if (message.type === "probe") {
      if (!tracker) throw new Error("Head tracker is not initialized");
      const canvas = new OffscreenCanvas(640, 480);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Synthetic inference canvas is unavailable");
      context.fillRect(0, 0, 640, 480);
      const bitmap = canvas.transferToImageBitmap();
      try { tracker.detectForVideo(bitmap, performance.now()); }
      finally { bitmap.close(); }
      self.postMessage({ type: "probe-result" });
    } else if (message.type === "frame") {
      const bitmap: ImageBitmap = message.bitmap;
      try {
        if (!tracker) throw new Error("Head tracker is not initialized");
        const result = tracker.detectForVideo(bitmap, message.time);
        const face = result.faceLandmarks[0];
        const a = face?.[33], b = face?.[263];
        const sample = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          span: Math.hypot(a.x - b.x, (a.y - b.y) * bitmap.height / bitmap.width) } : null;
        self.postMessage({ type: "sample", sample });
      } finally { bitmap.close(); }
    }
  } catch (error) { self.postMessage({ type: "error", error: String(error) }); }
};
