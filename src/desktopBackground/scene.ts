import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Fog,
  LineBasicMaterial, LineSegments, PerspectiveCamera, PlaneGeometry, Points,
  Scene, ShaderMaterial, WebGLRenderer, WireframeGeometry,
} from "three";
import type { viewSection } from "./layout";
import { DEFAULT_WORLD, worldColors, type WorldConfig } from "./worldConfig";
import { applyHeadView, CENTER, type HeadPose } from "./headPose";

/** Original, deterministic world content; no Windows, React, voice, or account dependencies. */
export function createTerrainView(canvas: HTMLCanvasElement, onFailure: (error: string) => void) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.debug.onShaderError = () => onFailure("The GPU could not compile the 3D scene shaders.");
  renderer.setPixelRatio(1); // Native layout is already physical pixels, even on mixed-DPI displays.
  const scene = new Scene();
  scene.background = new Color("#02060c");
  scene.fog = new Fog("#02060c", 35, 125);
  const camera = new PerspectiveCamera(52, 1, 0.1, 180);
  camera.position.set(0, 8, 24);
  camera.lookAt(0, 0, -30);

  const surface = new PlaneGeometry(160, 100, 120, 75);
  surface.rotateX(-Math.PI / 2);
  const positions = surface.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i) - 35;
    const y = Math.sin(x * 0.10 + z * 0.06) * 1.7
      + Math.cos(z * 0.15 - x * 0.04) * 1.1 + Math.sin(x * 0.18 - z * 0.11) * 0.45;
    positions.setXYZ(i, x, y - 2.5, z);
  }
  const wires = new WireframeGeometry(surface);
  const lineMaterial = new LineBasicMaterial({ color: "#168ebd", transparent: true, opacity: 0.42 });
  scene.add(new LineSegments(wires, lineMaterial));

  const dots = new BufferGeometry();
  dots.setAttribute("position", new BufferAttribute(new Float32Array(positions.array), 3));
  // Soft cyan points without textures, postprocessing, external images, or a frame loop.
  const pointMaterial = new ShaderMaterial({
    uniforms: { glowColor: { value: new Color("#26c7ff") } },
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `varying float distanceToEye;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        distanceToEye = -eye.z;
        gl_PointSize = clamp(160.0 / max(1.0, -eye.z), 1.5, 12.0);
        gl_Position = projectionMatrix * eye;
      }`,
    fragmentShader: `uniform vec3 glowColor; varying float distanceToEye;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float glow = exp(-radius * radius * 6.0);
        float fade = 1.0 - smoothstep(35.0, 125.0, distanceToEye);
        gl_FragColor = vec4(glowColor, glow * fade * 0.9);
      }`,
  });
  scene.add(new Points(dots, pointMaterial));
  let disposed = false;
  let surfaceWidth = 0, surfaceHeight = 0;
  const lost = (event: Event) => { event.preventDefault(); if (!disposed) onFailure("3D graphics context was lost. Enable again to retry."); };
  canvas.addEventListener("webglcontextlost", lost);

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", lost);
    surface.dispose(); wires.dispose(); dots.dispose();
    lineMaterial.dispose(); pointMaterial.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  }

  function setWorld(config: WorldConfig) {
    const colors = worldColors(config ?? DEFAULT_WORLD);
    scene.background = new Color(colors.background);
    if (scene.fog) scene.fog.color.set(colors.background);
    lineMaterial.color.set(colors.lines);
    (pointMaterial.uniforms.glowColor.value as Color).setRGB(...colors.glow);
  }
  setWorld(DEFAULT_WORLD);

  return {
    setWorld,
    render(view: ReturnType<typeof viewSection>, pose: HeadPose = CENTER) {
      if (disposed) return;
      const gl = renderer.getContext();
      const limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
      if (view.width > limit || view.height > limit) { dispose(); throw new Error(`Display exceeds GPU surface limit (${limit}px)`); }
      // Every surface is a slice of the same frustum, never a fresh full-screen camera.
      applyHeadView(camera, view, pose);
      if (surfaceWidth !== view.width || surfaceHeight !== view.height) {
        renderer.setSize(view.width, view.height, false);
        surfaceWidth = view.width; surfaceHeight = view.height;
      }
      renderer.render(scene, camera);
    },
    dispose,
  };
}
