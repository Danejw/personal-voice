/** Transient PCM energy for lip sync. Never stores audio or transcripts. */
export class SpeechEnvelope {
  private frames: { start: number; end: number; levels: number[]; frameMs: number }[] = [];
  private nextStart = 0;

  enqueue(pcm: ArrayBuffer, sampleRate: number, now = Date.now(), aheadMs = 0): void {
    if (pcm.byteLength < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) return;
    const frameSamples = Math.max(1, Math.round(sampleRate * 0.035));
    const view = new DataView(pcm);
    const count = Math.floor(pcm.byteLength / 2);
    const levels: number[] = [];
    for (let start = 0; start < count; start += frameSamples) {
      let sum = 0;
      const end = Math.min(count, start + frameSamples);
      for (let i = start; i < end; i++) {
        const v = view.getInt16(i * 2, true) / 32768;
        sum += v * v;
      }
      // Noise floor + soft compression: quiet syllables remain visible.
      const rms = Math.sqrt(sum / (end - start));
      levels.push(Math.min(1, Math.max(0, (rms - 0.012) * 5.4)));
    }
    const start = Math.max(now + Math.max(0, aheadMs), this.nextStart);
    const duration = count / sampleRate * 1000;
    this.frames.push({ start, end: start + duration, levels, frameMs: frameSamples / sampleRate * 1000 });
    this.nextStart = start + duration;
    this.trim(now);
  }

  level(now = Date.now()): number {
    this.trim(now);
    const frame = this.frames.find(f => f.start <= now && now < f.end);
    if (!frame) return 0;
    const index = Math.min(frame.levels.length - 1, Math.floor((now - frame.start) / frame.frameMs));
    return frame.levels[index] ?? 0;
  }

  clear(): void {
    this.frames = [];
    this.nextStart = 0;
  }

  private trim(now: number): void {
    while (this.frames.length && this.frames[0]!.end < now - 100) this.frames.shift();
    // Only in-memory animation energy, bounded even if playback stalls.
    if (this.frames.length > 180) this.frames.splice(0, this.frames.length - 180);
  }
}
