import { describe, expect, it, vi } from "vitest";
import { RemoteDictationDestination } from "@/remote-dictation/RemoteDictationDestination";

describe("RemoteDictationDestination", () => {
  it("locks the target at hold start and ignores later selection changes", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const destination = new RemoteDictationDestination({ send });
    destination.lockTarget({ id: "laptop", name: "Laptop" });
    destination.lockTarget({ id: "desktop", name: "Desktop" });
    await destination.deliver("hello from phone");
    expect(send).toHaveBeenCalledWith("hello from phone", { id: "desktop", name: "Desktop" });
  });

  it("fails when no target was locked", async () => {
    const destination = new RemoteDictationDestination({ send: vi.fn() });
    await expect(destination.deliver("hello")).rejects.toThrow(/No remote device/);
  });

  it("clears the lock after delivery so the next utterance can rebind", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const destination = new RemoteDictationDestination({ send });
    destination.lockTarget({ id: "laptop", name: "Laptop" });
    await destination.deliver("one");
    await expect(destination.deliver("two")).rejects.toThrow(/No remote device/);
  });
});
