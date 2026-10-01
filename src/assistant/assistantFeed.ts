import { getSupabase } from "@/services/supabase";

/** A hint that saved rows changed. The rows themselves are read again after this fires. */
export interface AssistantChangeFeed {
  subscribe(userId: string, onChange: () => void): () => void;
}

/** Supabase realtime on the conversation tables. No client means catch-up still runs on resume. */
export function supabaseAssistantFeed(): AssistantChangeFeed {
  return {
    subscribe(userId, onChange) {
      const client = getSupabase();
      if (!client) return () => undefined;
      const channel = client.channel(`assistant-sync:${userId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "assistant_conversations",
          filter: `user_id=eq.${userId}`,
        }, () => onChange())
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "assistant_messages",
          filter: `user_id=eq.${userId}`,
        }, () => onChange())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onChange();
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}

/** Supabase realtime on explicit memories. A hint to re-read; the rows are the list. */
export function supabaseMemoryFeed(): AssistantChangeFeed {
  return {
    subscribe(userId, onChange) {
      const client = getSupabase();
      if (!client) return () => undefined;
      const channel = client.channel(`assistant-memory:${userId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "assistant_memories",
          filter: `user_id=eq.${userId}`,
        }, () => onChange())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onChange();
        });
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}
