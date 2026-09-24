export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
  public: {
    Tables: {
      client_contacts: {
        Row: {
          client_id: string
          created_at: string
          email: string
          firm_id: string
          full_name: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email: string
          firm_id: string
          full_name: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string
          firm_id?: string
          full_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_firm_id_fkey"
            columns: ["client_id", "firm_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "firm_id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          created_at: string
          firm_id: string
          id: string
          kind: string
          name: string
          owner_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          firm_id: string
          id?: string
          kind?: string
          name: string
          owner_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          firm_id?: string
          id?: string
          kind?: string
          name?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_firm_id_owner_id_fkey"
            columns: ["firm_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "firm_members"
            referencedColumns: ["firm_id", "user_id"]
          },
        ]
      }
      firm_members: {
        Row: {
          created_at: string
          email: string
          firm_id: string
          full_name: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          firm_id: string
          full_name: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          firm_id?: string
          full_name?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: string
        }
        Relationships: []
      }
      item_files: {
        Row: {
          created_at: string
          filename: string
          firm_id: string
          id: string
          item_id: string
          mime: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          filename: string
          firm_id: string
          id?: string
          item_id: string
          mime: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          filename?: string
          firm_id?: string
          id?: string
          item_id?: string
          mime?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_files_item_id_firm_id_fkey"
            columns: ["item_id", "firm_id"]
            isOneToOne: false
            referencedRelation: "request_items"
            referencedColumns: ["id", "firm_id"]
          },
        ]
      }
      notifications_sent: {
        Row: {
          created_at: string
          id: string
          kind: string
          sent_on: string
          target_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          sent_on: string
          target_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          sent_on?: string
          target_id?: string
        }
        Relationships: []
      }
      request_items: {
        Row: {
          created_at: string
          description: string | null
          firm_id: string
          id: string
          kind: string
          position: number
          request_id: string
          required: boolean
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          text_answer: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          firm_id: string
          id?: string
          kind: string
          position: number
          request_id: string
          required?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          text_answer?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          firm_id?: string
          id?: string
          kind?: string
          position?: number
          request_id?: string
          required?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          text_answer?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_items_request_id_firm_id_fkey"
            columns: ["request_id", "firm_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id", "firm_id"]
          },
        ]
      }
      requests: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          due_date: string
          firm_id: string
          id: string
          sent_at: string | null
          status: string
          title: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          firm_id: string
          id?: string
          sent_at?: string | null
          status?: string
          title: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          firm_id?: string
          id?: string
          sent_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_client_id_firm_id_fkey"
            columns: ["client_id", "firm_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "firm_id"]
          },
        ]
      }
      template_items: {
        Row: {
          created_at: string
          description: string | null
          firm_id: string
          id: string
          kind: string
          position: number
          required: boolean
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          firm_id: string
          id?: string
          kind: string
          position: number
          required?: boolean
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          firm_id?: string
          id?: string
          kind?: string
          position?: number
          required?: boolean
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_items_template_id_firm_id_fkey"
            columns: ["template_id", "firm_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id", "firm_id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          firm_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          firm_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          firm_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_user_id_by_email: { Args: { email: string }; Returns: string }
      can_read_document: { Args: { name: string }; Returns: boolean }
      can_write_document: { Args: { name: string }; Returns: boolean }
      create_firm: {
        Args: { full_name: string; name: string }
        Returns: string
      }
      is_client_contact: { Args: { client_id: string }; Returns: boolean }
      is_firm_admin: { Args: { firm_id: string }; Returns: boolean }
      is_firm_contact: { Args: { firm_id: string }; Returns: boolean }
      is_firm_member: { Args: { firm_id: string }; Returns: boolean }
      refresh_request_status: {
        Args: { request_id: string }
        Returns: undefined
      }
      register_file: {
        Args: { filename: string; item_id: string; storage_path: string }
        Returns: string
      }
      remove_file: { Args: { file_id: string }; Returns: string }
      submit_item: {
        Args: { item_id: string; text_answer?: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

