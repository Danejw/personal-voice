// Generated from the Supabase schema (Supabase MCP `generate_typescript_types`, 2026-09-28).
// Regenerate after any migration instead of editing by hand.

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
          cloud_dictation_history: boolean
          language: string | null
          smart_transcription: boolean
          updated_at: string
          usage_epoch: number
          usage_intelligence: boolean
          user_id: string
        }
        Insert: {
          cloud_dictation_history?: boolean
          language?: string | null
          smart_transcription?: boolean
          updated_at?: string
          usage_epoch?: number
          usage_intelligence?: boolean
          user_id?: string
        }
        Update: {
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
      voice_notes: {
        Row: {
          created_at: string
          id: string
          source_device_id: string
          status: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_device_id: string
          status?: string
          text: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          source_device_id?: string
          status?: string
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
