// Generated from the Supabase schema (Supabase MCP `generate_typescript_types`, 2026-09-28).
// assistant_conversations, assistant_messages, and their RPCs match
// supabase/migrations/20260930200000_assistant_conversations.sql,
// 20260930210000_assistant_lease.sql, 20260930220000_assistant_context.sql,
// 20260930230000_assistant_memories.sql, and 20260930240000_assistant_memory_learning.sql.
// Regenerate from the deployed project after those migrations are applied.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      transform_profiles: {
        Row: {
          created_at: string
          id: string
          instruction: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instruction: string
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          instruction?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      devices: {
        Row: {
          created_at: string
          id: string
          last_seen: string | null
          name: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          last_seen?: string | null
          name: string
          platform: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen?: string | null
          name?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      device_context_requests: {
        Row: {
          answered_at: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          requester_device_id: string
          response: string | null
          status: string
          target_device_id: string
          user_id: string
          version: number
        }
        Insert: {
          answered_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          requester_device_id: string
          response?: string | null
          status?: string
          target_device_id: string
          user_id?: string
          version?: number
        }
        Update: {
          answered_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          requester_device_id?: string
          response?: string | null
          status?: string
          target_device_id?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      remote_dictation_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          expires_at: string
          id: string
          source_device_id: string
          status: string
          target_device_id: string
          text: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at: string
          id?: string
          source_device_id: string
          status?: string
          target_device_id: string
          text: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          expires_at?: string
          id?: string
          source_device_id?: string
          status?: string
          target_device_id?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      device_action_requests: {
        Row: {
          action: string
          answered_at: string | null
          argument: string
          created_at: string
          error: string | null
          id: string
          requester_device_id: string
          result: string | null
          status: string
          target_device_id: string
          user_id: string
          version: number
        }
        Insert: {
          action: string
          answered_at?: string | null
          argument: string
          created_at?: string
          error?: string | null
          id?: string
          requester_device_id: string
          result?: string | null
          status?: string
          target_device_id: string
          user_id?: string
          version?: number
        }
        Update: {
          action?: string
          answered_at?: string | null
          argument?: string
          created_at?: string
          error?: string | null
          id?: string
          requester_device_id?: string
          result?: string | null
          status?: string
          target_device_id?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      dictations: {
        Row: {
          created_at: string
          destination: string
          id: string
          outcome: string
          source_device_id: string
          text: string
          user_id: string
        }
        Insert: {
          created_at: string
          destination: string
          id: string
          outcome: string
          source_device_id: string
          text: string
          user_id?: string
        }
        Update: {
          created_at?: string
          destination?: string
          id?: string
          outcome?: string
          source_device_id?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      dictionary: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          term: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          term: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          term?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      handoffs: {
        Row: {
          consumed_at: string | null
          created_at: string
          id: string
          source_device_id: string
          target_device_id: string | null
          text: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          source_device_id: string
          target_device_id?: string | null
          text: string
          user_id?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          id?: string
          source_device_id?: string
          target_device_id?: string | null
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          assistant_learning_since: string | null
          assistant_memory_learning: boolean
          cloud_dictation_history: boolean
          language: string | null
          smart_transcription: boolean
          updated_at: string
          usage_epoch: number
          usage_intelligence: boolean
          user_id: string
        }
        Insert: {
          assistant_learning_since?: string | null
          assistant_memory_learning?: boolean
          cloud_dictation_history?: boolean
          language?: string | null
          smart_transcription?: boolean
          updated_at?: string
          usage_epoch?: number
          usage_intelligence?: boolean
          user_id?: string
        }
        Update: {
          assistant_learning_since?: string | null
          assistant_memory_learning?: boolean
          cloud_dictation_history?: boolean
          language?: string | null
          smart_transcription?: boolean
          updated_at?: string
          usage_epoch?: number
          usage_intelligence?: boolean
          user_id?: string
        }
        Relationships: []
      }
      usage_days: {
        Row: {
          counters: Json
          day: string
          device_id: string
          epoch: number
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          counters: Json
          day: string
          device_id: string
          epoch: number
          revision: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          counters?: Json
          day?: string
          device_id?: string
          epoch?: number
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          created_at: string
          id: string
          source_device_id: string
          source_type: string
          status: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_device_id: string
          source_type?: string
          status?: string
          text: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          source_device_id?: string
          source_type?: string
          status?: string
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      note_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          note_id: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id: string
          mime_type?: string | null
          note_id: string
          size_bytes: number
          storage_path: string
          user_id?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          note_id?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_conversations: {
        Row: {
          created_at: string
          deleted_at: string | null
          fence: number
          id: string
          lease_device_id: string | null
          lease_expires_at: string | null
          revision: number
          summary_body: string | null
          summary_fingerprint: string | null
          summary_through_seq: number | null
          context_items: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          fence?: number
          id: string
          lease_device_id?: string | null
          lease_expires_at?: string | null
          revision?: number
          summary_body?: string | null
          summary_fingerprint?: string | null
          summary_through_seq?: number | null
          context_items?: Json
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          fence?: number
          id?: string
          lease_device_id?: string | null
          lease_expires_at?: string | null
          revision?: number
          summary_body?: string | null
          summary_fingerprint?: string | null
          summary_through_seq?: number | null
          context_items?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_memories: {
        Row: {
          category: string | null
          confidence: string | null
          created_at: string
          extractor_version: string | null
          forgotten_at: string | null
          id: string
          kind: string
          memory_key: string
          origin: string
          revision: number
          scope: string
          source_conversation_id: string | null
          source_message_id: string | null
          status: string
          supersedes_id: string | null
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          forgotten_at?: string | null
          id: string
          kind: string
          memory_key: string
          origin: string
          revision: number
          scope?: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          status: string
          supersedes_id?: string | null
          updated_at?: string
          user_id?: string
          value: string
        }
        Update: {
          created_at?: string
          forgotten_at?: string | null
          id?: string
          kind?: string
          memory_key?: string
          origin?: string
          revision?: number
          scope?: string
          source_conversation_id?: string | null
          source_message_id?: string | null
          status?: string
          supersedes_id?: string | null
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          body: string
          citations: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
          seq: number
          source_device_id: string
          status: string
          tool_name: string | null
          tool_outcome: string | null
          user_id: string
        }
        Insert: {
          body: string
          citations?: Json
          conversation_id: string
          created_at?: string
          id: string
          role: string
          seq: number
          source_device_id: string
          status: string
          tool_name?: string | null
          tool_outcome?: string | null
          user_id: string
        }
        Update: {
          body?: string
          citations?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          seq?: number
          source_device_id?: string
          status?: string
          tool_name?: string | null
          tool_outcome?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_remote_dictation_request: {
        Args: {
          p_source_device_id: string
          p_target_device_id: string
          p_text: string
          p_ttl_seconds?: number
        }
        Returns: string
      }
      claim_remote_dictation_request: {
        Args: {
          p_id: string
          p_target_device_id: string
        }
        Returns: Json
      }
      complete_remote_dictation_request: {
        Args: {
          p_id: string
          p_target_device_id: string
          p_ok: boolean
          p_error?: string | null
        }
        Returns: boolean
      }
      get_remote_dictation_request: {
        Args: {
          p_id: string
        }
        Returns: Json
      }
      list_pending_remote_dictation_requests: {
        Args: {
          p_target_device_id: string
        }
        Returns: Json
      }
      delete_remote_dictation_request: {
        Args: {
          p_id: string
        }
        Returns: undefined
      }
      clear_usage_analytics: {
        Args: Record<string, never>
        Returns: number
      }
      upsert_usage_day: {
        Args: {
          p_counters: Json
          p_day: string
          p_device_id: string
          p_epoch: number
          p_revision: number
          p_updated_at: string
        }
        Returns: undefined
      }
      append_assistant_message: {
        Args: {
          p_body: string
          p_citations: Json
          p_conversation_id: string
          p_message_id: string
          p_role: string
          p_source_device_id: string
          p_status: string
          p_tool_name: string | null
          p_tool_outcome: string | null
          p_user_id: string
          p_fence: number | null
        }
        Returns: Json
      }
      claim_assistant_conversation: {
        Args: {
          p_device_id: string
          p_id: string
          p_takeover: boolean
          p_ttl_seconds: number
          p_user_id: string
        }
        Returns: Json
      }
      create_assistant_conversation: {
        Args: {
          p_id: string
          p_title: string
          p_user_id: string
        }
        Returns: Json
      }
      delete_assistant_conversation: {
        Args: {
          p_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      get_assistant_conversation: {
        Args: {
          p_id: string
          p_user_id: string
        }
        Returns: Json
      }
      list_assistant_conversations: {
        Args: {
          p_before_id: string | null
          p_before_updated_at: string | null
          p_limit: number
          p_user_id: string
        }
        Returns: Database["public"]["Tables"]["assistant_conversations"]["Row"][]
      }
      list_assistant_messages: {
        Args: {
          p_after_seq: number
          p_conversation_id: string
          p_limit: number
          p_user_id: string
        }
        Returns: Database["public"]["Tables"]["assistant_messages"]["Row"][]
      }
      release_assistant_conversation: {
        Args: {
          p_device_id: string
          p_fence: number
          p_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      save_assistant_context_items: {
        Args: {
          p_id: string
          p_items: Json
          p_user_id: string
        }
        Returns: Json
      }
      save_assistant_summary: {
        Args: {
          p_body: string
          p_fingerprint: string
          p_id: string
          p_replaces: string | null
          p_through_seq: number
          p_user_id: string
        }
        Returns: Json
      }
      forget_assistant_memory: {
        Args: {
          p_expected_revision: number
          p_key: string
          p_user_id: string
        }
        Returns: Json
      }
      list_assistant_memories: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      remember_assistant_memory: {
        Args: {
          p_expected_revision: number | null
          p_id: string
          p_kind: string
          p_key: string
          p_replace: boolean
          p_source_conversation_id: string | null
          p_source_message_id: string | null
          p_user_id: string
          p_value: string
        }
        Returns: Json
      }
      assistant_memory_suppressed: {
        Args: {
          p_key: string
          p_source_conversation_id: string | null
          p_user_id: string
        }
        Returns: boolean
      }
      commit_assistant_learning: {
        Args: {
          p_batch: Json
          p_user_id: string
        }
        Returns: Json
      }
      list_assistant_learning_batch: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      settle_assistant_memory_candidate: {
        Args: {
          p_id: string
          p_keep: boolean
          p_user_id: string
        }
        Returns: Json
      }
      rename_assistant_conversation: {
        Args: {
          p_id: string
          p_title: string
          p_user_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type TableRow<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
