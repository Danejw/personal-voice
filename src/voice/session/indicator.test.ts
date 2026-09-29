import { describe, expect, it } from "vitest";
import { isCancellable } from "@/voice/session/indicator";

describe("cancel routing", () => {
  it("routes Escape to cancel only before insertion", () => {
    const cancellable = (["IDLE", "CONNECTING", "LISTENING", "FINALIZING", "INSERTING", "ERROR"] as const).filter(isCancellable);
    expect(cancellable).toEqual(["CONNECTING", "LISTENING", "FINALIZING"]);
  });
});
