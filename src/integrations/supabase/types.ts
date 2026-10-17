export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_messages: {
        Row: {
          content: string
          created_at: string
          from_member_id: string | null
          id: string
          room_id: string
          to_member_id: string | null
          type: string
        }
        Insert: {
          content: string
          created_at?: string
          from_member_id?: string | null
          id?: string
          room_id: string
          to_member_id?: string | null
          type: string
        }
        Update: {
          content?: string
          created_at?: string
          from_member_id?: string | null
          id?: string
          room_id?: string
          to_member_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_from_member_id_fkey"
            columns: ["from_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_to_member_id_fkey"
            columns: ["to_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          member_id: string | null
          room_id: string
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind: string
          member_id?: string | null
          room_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          member_id?: string | null
          room_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          revoked_at: string | null
          room_id: string
          token: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          room_id: string
          token?: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          revoked_at?: string | null
          room_id?: string
          token?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          ambiguous: boolean
          confidence: number | null
          created_at: string
          delay_ms: number | null
          heard_by: string | null
          id: string
          language: string
          loudness: number
          room_id: string
          speaker_id: string | null
          text: string
        }
        Insert: {
          ambiguous?: boolean
          confidence?: number | null
          created_at?: string
          delay_ms?: number | null
          heard_by?: string | null
          id?: string
          language: string
          loudness?: number
          room_id: string
          speaker_id?: string | null
          text: string
        }
        Update: {
          ambiguous?: boolean
          confidence?: number | null
          created_at?: string
          delay_ms?: number | null
          heard_by?: string | null
          id?: string
          language?: string
          loudness?: number
          room_id?: string
          speaker_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "lines_heard_by_fkey"
            columns: ["heard_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lines_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lines_speaker_id_fkey"
            columns: ["speaker_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          caption_by_language: Json
          created_at: string
          created_by_member_id: string | null
          credit: string
          id: string
          kind: string
          line_id: string | null
          notebook_id: string | null
          query: string
          room_id: string
          url: string
        }
        Insert: {
          caption_by_language?: Json
          created_at?: string
          created_by_member_id?: string | null
          credit?: string
          id?: string
          kind: string
          line_id?: string | null
          notebook_id?: string | null
          query?: string
          room_id: string
          url: string
        }
        Update: {
          caption_by_language?: Json
          created_at?: string
          created_by_member_id?: string | null
          credit?: string
          id?: string
          kind?: string
          line_id?: string | null
          notebook_id?: string | null
          query?: string
          room_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_notebook_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "notebook"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          approved: boolean
          can_speak: boolean
          color: string
          created_at: string
          facts: string
          id: string
          invite_id: string | null
          language: string
          name: string
          role: string
          room_id: string
          voice_calibrated_at: string | null
          voice_device: string | null
          voice_level: number | null
          whisper_on: boolean
        }
        Insert: {
          approved?: boolean
          can_speak?: boolean
          color?: string
          created_at?: string
          facts?: string
          id?: string
          invite_id?: string | null
          language?: string
          name: string
          role?: string
          room_id: string
          voice_calibrated_at?: string | null
          voice_device?: string | null
          voice_level?: number | null
          whisper_on?: boolean
        }
        Update: {
          approved?: boolean
          can_speak?: boolean
          color?: string
          created_at?: string
          facts?: string
          id?: string
          invite_id?: string | null
          language?: string
          name?: string
          role?: string
          room_id?: string
          voice_calibrated_at?: string | null
          voice_device?: string | null
          voice_level?: number | null
          whisper_on?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "members_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      notebook: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          owner_member_id: string | null
          room_id: string
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind: string
          owner_member_id?: string | null
          room_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          owner_member_id?: string | null
          room_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notebook_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notebook_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_captions: {
        Row: {
          caption: string
          description: string
          id: string
          language: string
          photo_id: string
        }
        Insert: {
          caption?: string
          description?: string
          id?: string
          language: string
          photo_id: string
        }
        Update: {
          caption?: string
          description?: string
          id?: string
          language?: string
          photo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_captions_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          id: string
          room_id: string
          storage_path: string
          uploader_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          room_id: string
          storage_path: string
          uploader_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          room_id?: string
          storage_path?: string
          uploader_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string
          created_at: string
          host_member_id: string | null
          id: string
          roast_mode: boolean
          status: string
        }
        Insert: {
          code: string
          created_at?: string
          host_member_id?: string | null
          id?: string
          roast_mode?: boolean
          status?: string
        }
        Update: {
          code?: string
          created_at?: string
          host_member_id?: string | null
          id?: string
          roast_mode?: boolean
          status?: string
        }
        Relationships: []
      }
      speaker_corrections: {
        Row: {
          by_member_id: string | null
          changes: Json
          created_at: string
          id: string
          line_id: string | null
          room_id: string
          to_speaker_id: string | null
          undone_at: string | null
        }
        Insert: {
          by_member_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          line_id?: string | null
          room_id: string
          to_speaker_id?: string | null
          undone_at?: string | null
        }
        Update: {
          by_member_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          line_id?: string | null
          room_id?: string
          to_speaker_id?: string | null
          undone_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "speaker_corrections_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      speaker_eval_runs: {
        Row: {
          ambiguous_caught: number
          ambiguous_expected: number
          correct: number
          created_at: string
          details: Json
          device: string | null
          id: string
          total: number
        }
        Insert: {
          ambiguous_caught?: number
          ambiguous_expected?: number
          correct: number
          created_at?: string
          details?: Json
          device?: string | null
          id?: string
          total: number
        }
        Update: {
          ambiguous_caught?: number
          ambiguous_expected?: number
          correct?: number
          created_at?: string
          details?: Json
          device?: string | null
          id?: string
          total?: number
        }
        Relationships: []
      }
      translations: {
        Row: {
          id: string
          language: string
          line_id: string
          text: string
        }
        Insert: {
          id?: string
          language: string
          line_id: string
          text: string
        }
        Update: {
          id?: string
          language?: string
          line_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "translations_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      insert_line: {
        Args: {
          p_confidence?: number
          p_delay_ms?: number
          p_language: string
          p_loudness: number
          p_room_id: string
          p_speaker_id: string
          p_text: string
        }
        Returns: string
      }
      line_similarity: { Args: { a: string; b: string }; Returns: number }
      reassign_line: {
        Args: {
          p_by_member_id?: string
          p_line_id: string
          p_speaker_id: string
        }
        Returns: string
      }
      undo_speaker_correction: {
        Args: { p_correction_id: string }
        Returns: number
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
