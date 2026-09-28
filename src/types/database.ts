// Generated from the Supabase schema (Supabase MCP `generate_typescript_types`, 2026-09-27).
// Regenerate after any migration instead of editing by hand.

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
      settings: {
        Row: {
          language: string | null
          smart_transcription: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          language?: string | null
          smart_transcription?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          language?: string | null
          smart_transcription?: boolean
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
      [_ in never]: never
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
