export const PCM_SAMPLE_RATE = 16_000;
export const PCM_CHUNK_SAMPLES = 1_600;
/** 16-bit mono at `PCM_SAMPLE_RATE`. */
export const PCM_BYTES_PER_MS = (PCM_SAMPLE_RATE * 2) / 1000;

export function encodePcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return buffer;
}

export function concatPcm(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
