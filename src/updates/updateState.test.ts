import { describe, expect, it } from "vitest";
import type { AvailableUpdate } from "@/platform/PlatformAdapter";
import { CHECK_FAILED, initialUpdateState, updateReducer } from "@/updates/updateState";
import type { UpdateEvent, UpdateState } from "@/updates/updateState";

const update: AvailableUpdate = { version: "0.3.0", notes: "", action: "download", install: () => Promise.resolve() };

const run = (events: UpdateEvent[], from: UpdateState = initialUpdateState) => events.reduce(updateReducer, from);

describe("updateReducer", () => {
  it("reports an available update, then hands off the download", () => {
    const available = run([{ type: "check", manual: false }, { type: "checked", update }]);
    expect(available).toEqual({ kind: "available", update });
    expect(run([{ type: "install" }], available)).toEqual({ kind: "installing", update });
    expect(run([{ type: "install" }, { type: "installStarted" }], available)).toEqual({ kind: "handedOff", update });
  });

  it("reports up to date", () => {
    expect(run([{ type: "check", manual: true }, { type: "checked", update: null }])).toEqual({ kind: "upToDate" });
  });

  it("stays quiet when the startup check fails, but reports a manual one", () => {
    expect(run([{ type: "check", manual: false }, { type: "checkFailed" }])).toEqual(initialUpdateState);
    expect(run([{ type: "check", manual: true }, { type: "checkFailed" }]))
      .toEqual({ kind: "error", message: CHECK_FAILED, update: null });
  });

  it("keeps the update after a failed install so it can be retried", () => {
    const failed = run([
      { type: "check", manual: false }, { type: "checked", update }, { type: "install" },
      { type: "installFailed", message: "Signature mismatch" },
    ]);
    expect(failed).toEqual({ kind: "error", message: "Signature mismatch", update });
    expect(run([{ type: "install" }], failed)).toEqual({ kind: "installing", update });
  });

  it("ignores a second check while one is running or an install is underway", () => {
    const checking = run([{ type: "check", manual: false }]);
    expect(run([{ type: "check", manual: true }], checking)).toBe(checking);
    const installing: UpdateState = { kind: "installing", update };
    expect(run([{ type: "check", manual: true }], installing)).toBe(installing);
  });

  it("ignores results that arrive in the wrong state", () => {
    const installing: UpdateState = { kind: "installing", update };
    expect(run([{ type: "checked", update: null }], installing)).toBe(installing);
    expect(run([{ type: "checkFailed" }], installing)).toBe(installing);
    expect(run([{ type: "install" }], initialUpdateState)).toBe(initialUpdateState);
    expect(run([{ type: "installStarted" }], initialUpdateState)).toBe(initialUpdateState);
  });
});
