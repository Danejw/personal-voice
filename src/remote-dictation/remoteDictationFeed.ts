import { getSupabase } from "@/services/supabase";

/** A hint that a Remote Dictation row changed. The row is re-read after this fires. */
export interface RemoteDictationChangeFeed {
  subscribe(userId: string, targetDeviceId: string, onChange: (requestId?: string) => void): () => void;
}

/** Realtime on requests aimed at this device. Catch-up still runs without a client. */
export function supabaseRemoteDictationFeed(): RemoteDictationChangeFeed {
  return {
    subscribe(userId, targetDeviceId, onChange) {
      const client = getSupabase();
      if (!client) return () => undefined;
      const channel = client.channel(`remote-dictation:${userId}:${targetDeviceId}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "remote_dictation_requests",
          filter: `target_device_id=eq.${targetDeviceId}`,
        }, (payload) => {
          const id = (payload.new as { id?: unknown } | null)?.id;
          onChange(typeof id === "string" ? id : undefined);
        })
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "remote_dictation_requests",
          filter: `target_device_id=eq.${targetDeviceId}`,
        }, (payload) => {
          const id = (payload.new as { id?: unknown } | null)?.id;
          onChange(typeof id === "string" ? id : undefined);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onChange();
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
