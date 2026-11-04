import { describe, expect, it, vi } from "vitest";
import { isTrustedRemoteAction } from "@/assistant/computerActions";
import { fulfillComputerAction, type ComputerActionApi, type ComputerActionRow } from "@/assistant/computerRemote";

const pending: ComputerActionRow = {
  id: "one", userId: "owner", requesterDeviceId: "phone", targetDeviceId: "pc",
  action: "open_app", argument: "notepad", status: "pending",
  result: null, error: null, version: 2, expiresAt: "2027-01-01T00:00:00Z",
  requestSignature: "valid", responseSignature: null,
};

function receiver() {
  const answer = vi.fn(async () => {});
  const deny = vi.fn(async () => {});
  const api = {
    create: vi.fn(), get: vi.fn(), listPending: vi.fn(), remove: vi.fn(), answer, deny,
  } as unknown as ComputerActionApi;
  return { api, answer, deny };
}

describe("trusted remote action safety", () => {
  it("permits only two apps and Escape/Tab without PC confirmation", () => {
    for (const value of ["notepad", "calculator"]) {
      expect(isTrustedRemoteAction("open_app", value)).toBe(true);
    }
    for (const value of ["escape", "tab"]) {
      expect(isTrustedRemoteAction("press_shortcut", value)).toBe(true);
    }
    for (const value of ["copy", "paste", "undo", "select-all"]) {
      expect(isTrustedRemoteAction("press_shortcut", value)).toBe(false);
    }
    for (const action of ["insert_text", "click", "run_shell", "delete_file", "send_email"]) {
      expect(isTrustedRemoteAction(action, "hello")).toBe(false);
    }
  });

  it("claims once and executes exactly once without a manual approval", async () => {
    const { api, answer } = receiver();
    const execute = vi.fn(async () => "Opened Notepad.");
    const claimed = await fulfillComputerAction(api, pending, "windows", true, null, execute,
      { claim: async () => "claimed" });
    expect(claimed.action).toBe("answered");
    expect(execute).toHaveBeenCalledExactlyOnceWith("open_app", "notepad", true);
    expect(answer).toHaveBeenCalledOnce();

    const retry = await fulfillComputerAction(api, pending, "windows", true, null, execute,
      { claim: async () => "already" });
    expect(retry).toEqual({ action: "waiting" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("no grant, locked PC, or backend failure falls back to manual confirmation", async () => {
    const { api } = receiver();
    const execute = vi.fn(async () => "done");
    for (const claim of [async () => "none" as const, async () => { throw Error("locked"); }]) {
      const result = await fulfillComputerAction(api, pending, "windows", true, null, execute, { claim });
      expect(result).toMatchObject({ action: "waiting", label: "Open Notepad" });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("never bypasses the PC master remote-actions switch or the Windows platform", async () => {
    const { api, deny } = receiver();
    const execute = vi.fn(async () => "done");
    const claim = vi.fn(async () => "claimed" as const);
    for (const [platform, enabled] of [["windows", false], ["android", true]] as const) {
      expect((await fulfillComputerAction(api, pending, platform, enabled, null, execute, { claim })).action)
        .toBe("denied");
    }
    expect(deny).toHaveBeenCalledTimes(2);
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("an action already claimed may not run even when it is waiting for approval", async () => {
    const { api } = receiver();
    const execute = vi.fn(async () => "done");
    const result = await fulfillComputerAction(api, pending, "windows", true, null, execute,
      { claim: async () => "already" });
    expect(result).toEqual({ action: "waiting" });
    expect(execute).not.toHaveBeenCalled();
  });
});
