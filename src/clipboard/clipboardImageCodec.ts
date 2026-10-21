/** Clipboard image formats Personal Voice stores. PNG is preferred; BMP is legacy. */
export type ClipboardImageFormat = "png" | "bmp";

/** Matches the private storage bucket limit for one clipboard image. */
export const MAX_CLIPBOARD_IMAGE_BYTES = 10_485_760;

/** Largest raw BMP the native sampler may send before it is re-encoded as PNG. */
export const MAX_CLIPBOARD_BMP_TRANSPORT_BYTES = 33_554_432;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Sniffs the stored format from the file signature. Unknown data returns null. */
export function detectClipboardImageFormat(bytes: Uint8Array): ClipboardImageFormat | null {
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "png";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return null;
}

export function clipboardImageMime(bytes: Uint8Array): string {
  return detectClipboardImageFormat(bytes) === "png" ? "image/png" : "image/bmp";
}

/**
 * Encodes raw RGBA pixels as a 32-bit BMP. Canvas cannot encode BMP, so copying a
 * stored PNG back to the Windows clipboard builds the file manually.
 */
export function encodeBmpFromPixels(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error("That image could not be copied.");
  }
  if (rgba.length !== width * height * 4) throw new Error("That image could not be copied.");
  const pixelBytes = width * height * 4;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, pixelBytes, true);
  // BMP rows run bottom to top, and each pixel is BGRA instead of RGBA.
  for (let y = 0; y < height; y += 1) {
    const sourceRow = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow * width + x) * 4;
      const target = 54 + (y * width + x) * 4;
      bytes[target] = rgba[source + 2] ?? 0;
      bytes[target + 1] = rgba[source + 1] ?? 0;
      bytes[target + 2] = rgba[source] ?? 0;
      bytes[target + 3] = rgba[source + 3] ?? 0;
    }
  }
  return bytes;
}

async function decodeToCanvas(bytes: Uint8Array): Promise<{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("That image could not be copied.");
  }
  const format = detectClipboardImageFormat(bytes);
  if (!format) throw new Error("That image could not be copied.");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: clipboardImageMime(bytes) }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image could not be copied.");
    context.drawImage(bitmap, 0, 0);
    return { canvas, context };
  } finally {
    bitmap.close();
  }
}

/**
 * Re-encodes a transported BMP as PNG for storage and sync. Outside a web view the
 * original BMP is kept, so tests and non-browser callers still work.
 */
export async function bmpToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (detectClipboardImageFormat(bytes) !== "bmp") return bytes;
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return bytes;
  try {
    const { canvas } = await decodeToCanvas(bytes);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return bytes;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return bytes;
  }
}

/** Converts stored image bytes to the BMP the Windows clipboard writer accepts. */
export async function imageBytesToBmp(bytes: Uint8Array): Promise<Uint8Array> {
  const format = detectClipboardImageFormat(bytes);
  if (format === "bmp") return bytes;
  if (format !== "png") throw new Error("That image could not be copied.");
  const { canvas, context } = await decodeToCanvas(bytes);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return encodeBmpFromPixels(pixels.width, pixels.height, pixels.data);
}
