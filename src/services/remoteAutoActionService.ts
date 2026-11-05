import { pairServerAction } from "@/services/devicePairingService";

/**
 * Windows-only, per-request one-use claim authenticated with the PC's native
 * pairing key. The receiver additionally verifies pairing and lock state.
 * No grant or repeated desktop approval is necessary once Allow remote actions
 * has been enabled on this PC.
 */
export const remoteAutoActionApi = {
  async claim(pcDeviceId: string, requestId: string): Promise<"none" | "claimed" | "already"> {
    const result = await pairServerAction<unknown>(pcDeviceId, "auto_claim", { requestId });
    if (result !== "none" && result !== "claimed" && result !== "already") {
      throw new Error("Invalid remote action claim response.");
    }
    return result;
  },
  async validate(pcDeviceId: string, requestId: string): Promise<boolean> {
    return pairServerAction<boolean>(pcDeviceId, "auto_validate", { requestId });
  },
  async wasClaimed(pcDeviceId: string, requestId: string): Promise<boolean> {
    return pairServerAction<boolean>(pcDeviceId, "auto_seen", { requestId });
  },
};
