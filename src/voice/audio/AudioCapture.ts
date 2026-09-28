export interface AudioCapture {
  start(onChunk: (pcm: ArrayBuffer) => void, onError: (message: string) => void): Promise<void>;
  /** Flush the final partial chunk before resolving, unless cancelling. */
  stop(flush: boolean): Promise<void>;
}
