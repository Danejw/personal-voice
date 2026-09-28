import { encodePcm16, PCM_CHUNK_SAMPLES } from "./pcm";

declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class PcmProcessor extends AudioWorkletProcessor {
  private samples = new Float32Array(PCM_CHUNK_SAMPLES);
  private length = 0;
  private ended = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "flush") {
        this.ended = true;
        this.flush();
        this.port.postMessage("flushed");
      }
    };
  }

  private flush() {
    if (!this.length) return;
    const pcm = encodePcm16(this.samples.subarray(0, this.length));
    this.port.postMessage(pcm, [pcm]);
    this.length = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.ended) return false;
    // The node explicitly downmixes to one channel. Output stays silent.
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.samples[this.length++] = sample;
      if (this.length === PCM_CHUNK_SAMPLES) this.flush();
    }
    return true;
  }
}

registerProcessor("voice-pcm", PcmProcessor);
