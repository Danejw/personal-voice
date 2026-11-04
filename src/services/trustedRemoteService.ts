import { pairServerAction } from "@/services/devicePairingService";
import { pairedPublicKey } from "@/assistant/remoteVoiceProof";

export interface TrustedRemoteGrant {
  id: string;
  phone_device_id: string;
  created_at: string;
  expires_at: string;
  stopped_at: string | null;
}

/** Only invoke on the Windows PC whose OS-protected key signs the request. */
export const trustedRemoteApi = {
  async list(pcDeviceId: string): Promise<TrustedRemoteGrant[]> {
    return pairServerAction<TrustedRemoteGrant[]>(pcDeviceId, "trusted_list");
  },
  async start(pcDeviceId: string, phoneDeviceId: string): Promise<TrustedRemoteGrant> {
    if (pcDeviceId === phoneDeviceId) throw new Error("Select a different paired phone.");
    await pairedPublicKey(pcDeviceId, phoneDeviceId);
    return pairServerAction<TrustedRemoteGrant>(pcDeviceId, "trusted_start", { phoneId: phoneDeviceId });
  },
  async stop(pcDeviceId: string, grantId: string): Promise<void> {
    const stopped = await pairServerAction<boolean>(pcDeviceId, "trusted_stop", { grantId });
    if (!stopped) throw new Error("That trusted session has already stopped.");
  },
  async claim(pcDeviceId: string, requestId: string): Promise<"none" | "claimed" | "already"> {
    const state = await pairServerAction<unknown>(pcDeviceId, "trusted_claim", { requestId });
    if (state !== "none" && state !== "claimed" && state !== "already") {
      throw new Error("Invalid trusted action claim response.");
    }
    return state;
  },
  async wasClaimed(pcDeviceId: string, requestId: string): Promise<boolean> {
    return pairServerAction<boolean>(pcDeviceId, "trusted_seen", { requestId });
  },
  async validate(pcDeviceId: string, requestId: string): Promise<boolean> {
    return pairServerAction<boolean>(pcDeviceId, "trusted_validate", { requestId });
  },
};
