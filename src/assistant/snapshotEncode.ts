import { fitSnapshotEdge, type ScreenSnapshot } from "@/assistant/snapshot";

/**
 * Draws one RGBA frame into a JPEG small enough for a Live video frame.
 * The canvas exists only in memory.
 */
export function encodeSnapshotJpeg(rgbaBase64: string, width: number, height: number): string {
  const target = fitSnapshotEdge(width, height);
  const binary = atob(rgbaBase64);
  const rgba = new Uint8ClampedArray(binary.length);
  for (let index = 0; index < binary.length; index += 1) rgba[index] = binary.charCodeAt(index);
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("The screenshot could not be prepared.");
  const needed = width * height * 4;
  const pixels = rgba.length === needed ? rgba : rgba.subarray(0, needed);
  if (pixels.length !== needed) throw new Error("The screenshot could not be prepared.");
  sourceContext.putImageData(new ImageData(pixels, width, height), 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The screenshot could not be prepared.");
  context.drawImage(source, 0, 0, target.width, target.height);
  let quality = 0.72;
  let jpeg = canvas.toDataURL("image/jpeg", quality);
  while (jpeg.length > 1_400_000 && quality > 0.4) {
    quality -= 0.12;
    jpeg = canvas.toDataURL("image/jpeg", quality);
  }
  const marker = "base64,";
  const start = jpeg.indexOf(marker);
  if (start < 0) throw new Error("The screenshot could not be prepared.");
  return jpeg.slice(start + marker.length);
}

export function previewUrl(snapshot: Pick<ScreenSnapshot, "jpeg">): string {
  return `data:image/jpeg;base64,${snapshot.jpeg}`;
}
