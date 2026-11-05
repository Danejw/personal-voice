import { beforeEach, describe, expect, it, vi } from "vitest";
import { computerJobsApi } from "@/services/computerJobsService";
import { pairServerAction } from "@/services/devicePairingService";
import { getSupabase } from "@/services/supabase";

vi.mock("@/services/devicePairingService", () => ({ pairServerAction: vi.fn() }));
vi.mock("@/services/supabase", () => ({ getSupabase: vi.fn() }));

const job = {
  id: "job-1", user_id: "account", requester_device_id: "phone",
  target_device_id: "pc", goal: "Open Notepad and type Hello World.",
  status: "running", phase: "observing", steps: 0, last_action: "",
  result: "", evidence: null, worker_token: "lease-1",
  lease_until: "2026-11-05T23:00:00Z", heartbeat_at: "2026-11-05T22:59:00Z",
  stop_requested_at: null,
  created_at: "2026-11-05T22:58:00Z", updated_at: "2026-11-05T22:59:00Z",
};

describe("durable signed Computer Use jobs", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("persists the original goal via native-signed Windows operations only", async () => {
    vi.mocked(pairServerAction).mockResolvedValue(job);
    const accepted = await computerJobsApi.create("pc", "job-1");
    expect(accepted.goal).toContain("Notepad");
    expect(pairServerAction).toHaveBeenCalledWith("pc", "job_mutate", {
      event: "create", requestId: "job-1",
    });
    await computerJobsApi.activate("pc", "job-1");
    expect(pairServerAction).toHaveBeenCalledWith("pc", "job_mutate", {
      event: "activate", requestId: "job-1",
    });
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("signs the in-flight and committed checkpoints against one lease", async () => {
    vi.mocked(pairServerAction).mockResolvedValue(job);
    await computerJobsApi.checkpoint("pc", "job-1", "lease-1", {
      status: "running", phase: "applying", steps: 0, lastAction: "click",
    });
    await computerJobsApi.checkpoint("pc", "job-1", "lease-1", {
      status: "running", phase: "observing", steps: 1, lastAction: "click",
    });
    expect(pairServerAction).toHaveBeenNthCalledWith(1, "pc", "job_mutate", {
      event: "checkpoint", requestId: "job-1", token: "lease-1",
      status: "running", phase: "applying", steps: 0, lastAction: "click",
      result: "", evidence: null,
    });
    expect(pairServerAction).toHaveBeenNthCalledWith(2, "pc", "job_mutate", {
      event: "checkpoint", requestId: "job-1", token: "lease-1",
      status: "running", phase: "observing", steps: 1, lastAction: "click",
      result: "", evidence: null,
    });
  });

  it("only trusts the signed server recovery decision", async () => {
    vi.mocked(pairServerAction).mockResolvedValueOnce({ resumed: false, job: {
      ...job, status: "needs_review", phase: "done", worker_token: null,
    } });
    const decision = await computerJobsApi.reconcile("pc", true);
    expect(decision?.resumed).toBe(false);
    expect(decision?.job.status).toBe("needs_review");
    expect(pairServerAction).toHaveBeenCalledWith("pc", "job_mutate", {
      event: "reconcile", canResume: true,
    });
    vi.mocked(pairServerAction).mockResolvedValueOnce({ resumed: "yes", job });
    await expect(computerJobsApi.reconcile("pc", true)).rejects.toThrow("Invalid recovery decision");
  });

  it("sends a signed stop intent through native Windows identity", async () => {
    vi.mocked(pairServerAction).mockResolvedValue(job);
    await computerJobsApi.requestStop("pc", "job-1", "lease-1");
    expect(pairServerAction).toHaveBeenCalledWith("pc", "job_mutate", {
      event: "request_stop", requestId: "job-1", token: "lease-1",
    });
  });

  it("reads durable progress on the phone without granting write access", async () => {
    const maybeSingle = vi.fn(async () => ({ data: job, error: null }));
    const eq = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnValue({ eq, order, limit, maybeSingle });
    // The PostgREST chain is intentionally read-only.
    vi.mocked(getSupabase).mockReturnValue({
      from: () => ({ select }),
    } as unknown as NonNullable<ReturnType<typeof getSupabase>>);
    const found = await computerJobsApi.latest("account", "pc");
    expect(found?.steps).toBe(0);
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("user_id", "account");
    expect(eq).toHaveBeenCalledWith("target_device_id", "pc");
    expect(pairServerAction).not.toHaveBeenCalled();
  });
});
