import type { TextAction } from "@/text/TextAction";
import { transformText } from "@/transforms/transformText";
import type { TransformProfile } from "@/transforms/transformProfile";
import type { TranscriptDestination } from "@/voice/transcript/TranscriptDestination";

/** Applies the currently selected transform to finalized text before routing it to its destination. */
export class TransformingDestination implements TranscriptDestination {
  constructor(
    private destination: TranscriptDestination,
    private action: TextAction,
    private profile: () => TransformProfile | null,
  ) {}

  async deliver(transcript: string): Promise<void> {
    const profile = this.profile();
    const text = profile ? await transformText(this.action, transcript, profile) : transcript;
    await this.destination.deliver(text);
  }
}
