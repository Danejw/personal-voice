/** Windows CF_DIB clipboard payload for a user-approved camera photo.
 * Decoding happens in the WebView; no photo is written to the filesystem.
 */
import type { CameraPhoto } from "@/assistant/cameraPhoto";

const HEADER_LENGTH = 40;
const MAX_PIXELS = 1600 * 1600;

export function rgbaToDib(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > MAX_PIXELS || rgba.length !== width * height * 4) {
    throw new Error("Camera image dimensions are not supported.");
  }
  const size = HEADER_LENGTH + rgba.length;
  const output = new Uint8Array(size);
  const header = new DataView(output.buffer);
  header.setUint32(0, HEADER_LENGTH, true);
  header.setInt32(4, width, true);
  header.setInt32(8, height, true); // Positive height = bottom-up Windows DIB.
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  header.setUint32(20, rgba.length, true);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = HEADER_LENGTH + ((height - 1 - y) * width + x) * 4;
      output[to] = rgba[from + 2] ?? 0;
      output[to + 1] = rgba[from + 1] ?? 0;
      output[to + 2] = rgba[from] ?? 0;
      output[to + 3] = 0; // Unused alpha byte for BI_RGB, not transparency.
    }
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const block = 24 * 1024; // Divisible by 3, so concatenated Base64 blocks stay valid.
  for (let offset = 0; offset < bytes.length; offset += block) {
    const sub = bytes.subarray(offset, offset + block);
    let raw = "";
    for (let i = 0; i < sub.length; i += 1) raw += String.fromCharCode(sub[i] ?? 0);
    chunks.push(btoa(raw));
  }
  return chunks.join("");
}

export async function cameraPhotoToDibBase64(photo: CameraPhoto): Promise<string> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${photo.jpeg}`;
  await img.decode();
  if (img.naturalWidth !== photo.width || img.naturalHeight !== photo.height) {
    throw new Error("Camera photo dimensions did not match the captured frame.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot decode the camera image.");
  context.drawImage(img, 0, 0);
  return bytesToBase64(rgbaToDib(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
}
