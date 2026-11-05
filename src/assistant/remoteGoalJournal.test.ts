import { describe, expect, it } from "vitest";
import { remoteGoalJournalKey, restoreRemoteGoal, saveRemoteGoal } from "@/assistant/remoteGoalJournal";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}
const base = {
  jobId: "goal-7", requesterDeviceId: "phone", status: "running" as const,
  steps: 4, lastAction: "Clicked Save", result: "", updatedAt: 100,
};
describe("Windows remote goal crash journal", () => {
  it("restores a running task as interrupted and never replays actions", () => {
    const db = storage();
    saveRemoteGoal(db, "u1", "pc1", base);
    const recovered = restoreRemoteGoal(db, "u1", "pc1");
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.steps).toBe(4);
    expect(recovered?.jobId).toBe("goal-7");
    expect(restoreRemoteGoal(db, "u1", "pc1")?.status).toBe("interrupted");
  });
  it("retains explicit stop intent across Windows process restarts", () => {
    const db = storage();
    saveRemoteGoal(db, "u1", "pc1", { ...base, status: "stopping", stopRequested: true });
    const recovered = restoreRemoteGoal(db, "u1", "pc1");
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.stopRequested).toBe(true);
  });
  it("keeps completed terminal records but isolates account and device", () => {
    const db = storage();
    saveRemoteGoal(db, "u1", "pc1", { ...base, status: "needs_review" });
    expect(restoreRemoteGoal(db, "u1", "pc1")?.status).toBe("needs_review");
    expect(restoreRemoteGoal(db, "u2", "pc1")).toBeNull();
    expect(restoreRemoteGoal(db, "u1", "pc2")).toBeNull();
  });
  it("rejects malformed and corrupt state", () => {
    const db = storage();
    db.setItem(remoteGoalJournalKey("u1", "pc1"), '{"jobId":7}');
    expect(restoreRemoteGoal(db, "u1", "pc1")).toBeNull();
    db.setItem(remoteGoalJournalKey("u1", "pc1"), "{");
    expect(restoreRemoteGoal(db, "u1", "pc1")).toBeNull();
  });
});
