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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_scripts: {
        Row: {
          content: string
          name: string
          updated_at: string
        }
        Insert: {
          content: string
          name: string
          updated_at?: string
        }
        Update: {
          content?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      answers: {
        Row: {
          content: string | null
          created_at: string
          feedback: string | null
          file_paths: Json
          file_url: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          org_id: string
          question_id: string
          score: number | null
          session_id: string
          slot_scores: Json | null
          slot_values: Json | null
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          feedback?: string | null
          file_paths?: Json
          file_url?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          org_id: string
          question_id: string
          score?: number | null
          session_id: string
          slot_scores?: Json | null
          slot_values?: Json | null
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          feedback?: string | null
          file_paths?: Json
          file_url?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          org_id?: string
          question_id?: string
          score?: number | null
          session_id?: string
          slot_scores?: Json | null
          slot_values?: Json | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_methods: {
        Row: {
          billing_key: string
          card_company: string | null
          card_number: string | null
          created_at: string
          customer_key: string
          org_id: string
          registered_by: string | null
          updated_at: string
        }
        Insert: {
          billing_key: string
          card_company?: string | null
          card_number?: string | null
          created_at?: string
          customer_key: string
          org_id: string
          registered_by?: string | null
          updated_at?: string
        }
        Update: {
          billing_key?: string
          card_company?: string | null
          card_number?: string | null
          created_at?: string
          customer_key?: string
          org_id?: string
          registered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_methods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_payments: {
        Row: {
          amount: number
          approved_at: string | null
          card_company: string | null
          card_number: string | null
          created_at: string
          failure_code: string | null
          failure_message: string | null
          id: string
          order_id: string
          order_name: string
          org_id: string
          payment_key: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subscription_id: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          card_company?: string | null
          card_number?: string | null
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          order_id: string
          order_name: string
          org_id: string
          payment_key?: string | null
          period_end?: string | null
          period_start?: string | null
          status: string
          subscription_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          card_company?: string | null
          card_number?: string | null
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          order_id?: string
          order_name?: string
          org_id?: string
          payment_key?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          applicant_id: string | null
          cert_number: string
          created_at: string
          exam_id: string
          grade: string | null
          grade_code: string | null
          grade_label: string | null
          grade_level_id: string | null
          id: string
          issued_at: string
          org_id: string
          session_id: string
          status: Database["public"]["Enums"]["cert_status"]
        }
        Insert: {
          applicant_id?: string | null
          cert_number: string
          created_at?: string
          exam_id: string
          grade?: string | null
          grade_code?: string | null
          grade_label?: string | null
          grade_level_id?: string | null
          id?: string
          issued_at?: string
          org_id: string
          session_id: string
          status?: Database["public"]["Enums"]["cert_status"]
        }
        Update: {
          applicant_id?: string | null
          cert_number?: string
          created_at?: string
          exam_id?: string
          grade?: string | null
          grade_code?: string | null
          grade_label?: string | null
          grade_level_id?: string | null
          id?: string
          issued_at?: string
          org_id?: string
          session_id?: string
          status?: Database["public"]["Enums"]["cert_status"]
        }
        Relationships: [
          {
            foreignKeyName: "certifications_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      competencies: {
        Row: {
          code: string
          created_at: string
          description: string | null
          framework_id: string
          id: string
          name: string
          org_id: string | null
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          framework_id: string
          id?: string
          name: string
          org_id?: string | null
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          framework_id?: string
          id?: string
          name?: string
          org_id?: string | null
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competencies_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "competency_frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competencies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_frameworks: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competency_frameworks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_chat_usage: {
        Row: {
          day: string
          ip_hash: string
          turns: number
          updated_at: string
        }
        Insert: {
          day?: string
          ip_hash: string
          turns?: number
          updated_at?: string
        }
        Update: {
          day?: string
          ip_hash?: string
          turns?: number
          updated_at?: string
        }
        Relationships: []
      }
      exam_agent_artifacts: {
        Row: {
          agent_id: string
          bytes: number | null
          created_at: string
          id: string
          mime_type: string | null
          org_id: string
          sandbox_path: string
          sha256: string | null
          storage_path: string | null
          submitted: boolean
        }
        Insert: {
          agent_id: string
          bytes?: number | null
          created_at?: string
          id?: string
          mime_type?: string | null
          org_id: string
          sandbox_path: string
          sha256?: string | null
          storage_path?: string | null
          submitted?: boolean
        }
        Update: {
          agent_id?: string
          bytes?: number | null
          created_at?: string
          id?: string
          mime_type?: string | null
          org_id?: string
          sandbox_path?: string
          sha256?: string | null
          storage_path?: string | null
          submitted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exam_agent_artifacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "exam_agent_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_agent_artifacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_agent_events: {
        Row: {
          agent_id: string
          content: Json
          created_at: string
          id: string
          kind: string
          org_id: string
          role: string
          seq: number
        }
        Insert: {
          agent_id: string
          content?: Json
          created_at?: string
          id?: string
          kind: string
          org_id: string
          role: string
          seq: number
        }
        Update: {
          agent_id?: string
          content?: Json
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          role?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_agent_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "exam_agent_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_agent_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_agent_sessions: {
        Row: {
          closed_at: string | null
          completion_tokens: number
          env_snapshot: Json
          id: string
          last_active_at: string
          org_id: string
          prompt_tokens: number
          question_id: string | null
          sandbox_id: string | null
          sandbox_provider: string
          session_id: string
          started_at: string
          status: string
          template: string | null
          turn_count: number
        }
        Insert: {
          closed_at?: string | null
          completion_tokens?: number
          env_snapshot?: Json
          id?: string
          last_active_at?: string
          org_id: string
          prompt_tokens?: number
          question_id?: string | null
          sandbox_id?: string | null
          sandbox_provider?: string
          session_id: string
          started_at?: string
          status?: string
          template?: string | null
          turn_count?: number
        }
        Update: {
          closed_at?: string | null
          completion_tokens?: number
          env_snapshot?: Json
          id?: string
          last_active_at?: string
          org_id?: string
          prompt_tokens?: number
          question_id?: string | null
          sandbox_id?: string | null
          sandbox_provider?: string
          session_id?: string
          started_at?: string
          status?: string
          template?: string | null
          turn_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_agent_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_agent_sessions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_agent_sessions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_agent_sessions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_announcements: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          message: string
          org_id: string
          sender_id: string | null
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          message: string
          org_id: string
          sender_id?: string | null
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          message?: string
          org_id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_announcements_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_announcements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_chat_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          org_id: string
          sender_id: string | null
          sender_role: Database["public"]["Enums"]["app_role"] | null
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          org_id: string
          sender_id?: string | null
          sender_role?: Database["public"]["Enums"]["app_role"] | null
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          org_id?: string
          sender_id?: string | null
          sender_role?: Database["public"]["Enums"]["app_role"] | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_chat_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_invitations: {
        Row: {
          accepted_at: string | null
          allow_dual_monitor: boolean
          allow_no_screen_share: boolean
          allow_no_webcam: boolean
          code_hash: string | null
          created_at: string
          email: string
          exam_id: string
          exemption_reason: string | null
          id: string
          invite_code: string
          is_used: boolean
          name: string | null
          org_id: string
          sent_at: string | null
          session_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          allow_dual_monitor?: boolean
          allow_no_screen_share?: boolean
          allow_no_webcam?: boolean
          code_hash?: string | null
          created_at?: string
          email: string
          exam_id: string
          exemption_reason?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean
          name?: string | null
          org_id: string
          sent_at?: string | null
          session_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          allow_dual_monitor?: boolean
          allow_no_screen_share?: boolean
          allow_no_webcam?: boolean
          code_hash?: string | null
          created_at?: string
          email?: string
          exam_id?: string
          exemption_reason?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean
          name?: string | null
          org_id?: string
          sent_at?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_invitations_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_invitations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          created_at: string
          exam_id: string
          id: string
          order_num: number
          org_id: string
          points_override: number | null
          question_id: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          order_num?: number
          org_id: string
          points_override?: number | null
          question_id: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          order_num?: number
          org_id?: string
          points_override?: number | null
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sessions: {
        Row: {
          applicant_id: string | null
          created_at: string
          exam_id: string
          grade_level_id: string | null
          id: string
          id_card_url: string | null
          is_flagged: boolean
          max_score: number | null
          monitoring_notes: string | null
          org_id: string
          phase1_completed_at: string | null
          score_total: number | null
          start_time: string | null
          status: Database["public"]["Enums"]["session_status"]
          submit_reason: string | null
          submit_time: string | null
          updated_at: string
        }
        Insert: {
          applicant_id?: string | null
          created_at?: string
          exam_id: string
          grade_level_id?: string | null
          id?: string
          id_card_url?: string | null
          is_flagged?: boolean
          max_score?: number | null
          monitoring_notes?: string | null
          org_id: string
          phase1_completed_at?: string | null
          score_total?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          submit_reason?: string | null
          submit_time?: string | null
          updated_at?: string
        }
        Update: {
          applicant_id?: string | null
          created_at?: string
          exam_id?: string
          grade_level_id?: string | null
          id?: string
          id_card_url?: string | null
          is_flagged?: boolean
          max_score?: number | null
          monitoring_notes?: string | null
          org_id?: string
          phase1_completed_at?: string | null
          score_total?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          submit_reason?: string | null
          submit_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_sessions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sessions_grade_level_id_fkey"
            columns: ["grade_level_id"]
            isOneToOne: false
            referencedRelation: "grade_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          agent_env: Json
          alert_event_types: string[]
          allow_dual_monitor: boolean
          block_late_entry: boolean
          created_at: string
          created_by: string | null
          custom_texts: Json
          daily_room_name: string | null
          daily_room_url: string | null
          description: string | null
          difficulty_tier: string | null
          duration_minutes: number
          entry_start_minutes: number
          exam_date: string | null
          framework_id: string | null
          grade: string | null
          grade_scale_id: string | null
          id: string
          instructions: string | null
          is_test_mode: boolean
          late_entry_minutes: number
          max_participants: number | null
          org_id: string
          pass_score: number
          phase1_minutes: number
          phased_enabled: boolean
          proctoring: boolean
          registration_mode: Database["public"]["Enums"]["registration_mode"]
          require_identity: boolean
          skip_face_match: boolean
          skip_waiting_checks: boolean
          status: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at: string
          use_absolute_end: boolean
        }
        Insert: {
          agent_env?: Json
          alert_event_types?: string[]
          allow_dual_monitor?: boolean
          block_late_entry?: boolean
          created_at?: string
          created_by?: string | null
          custom_texts?: Json
          daily_room_name?: string | null
          daily_room_url?: string | null
          description?: string | null
          difficulty_tier?: string | null
          duration_minutes?: number
          entry_start_minutes?: number
          exam_date?: string | null
          framework_id?: string | null
          grade?: string | null
          grade_scale_id?: string | null
          id?: string
          instructions?: string | null
          is_test_mode?: boolean
          late_entry_minutes?: number
          max_participants?: number | null
          org_id: string
          pass_score?: number
          phase1_minutes?: number
          phased_enabled?: boolean
          proctoring?: boolean
          registration_mode?: Database["public"]["Enums"]["registration_mode"]
          require_identity?: boolean
          skip_face_match?: boolean
          skip_waiting_checks?: boolean
          status?: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at?: string
          use_absolute_end?: boolean
        }
        Update: {
          agent_env?: Json
          alert_event_types?: string[]
          allow_dual_monitor?: boolean
          block_late_entry?: boolean
          created_at?: string
          created_by?: string | null
          custom_texts?: Json
          daily_room_name?: string | null
          daily_room_url?: string | null
          description?: string | null
          difficulty_tier?: string | null
          duration_minutes?: number
          entry_start_minutes?: number
          exam_date?: string | null
          framework_id?: string | null
          grade?: string | null
          grade_scale_id?: string | null
          id?: string
          instructions?: string | null
          is_test_mode?: boolean
          late_entry_minutes?: number
          max_participants?: number | null
          org_id?: string
          pass_score?: number
          phase1_minutes?: number
          phased_enabled?: boolean
          proctoring?: boolean
          registration_mode?: Database["public"]["Enums"]["registration_mode"]
          require_identity?: boolean
          skip_face_match?: boolean
          skip_waiting_checks?: boolean
          status?: Database["public"]["Enums"]["exam_status"]
          title?: string
          updated_at?: string
          use_absolute_end?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exams_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "competency_frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_grade_scale_id_fkey"
            columns: ["grade_scale_id"]
            isOneToOne: false
            referencedRelation: "grade_scales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_levels: {
        Row: {
          code: string
          color: string | null
          created_at: string
          id: string
          is_passing: boolean
          min_percent: number
          name: string
          org_id: string | null
          scale_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          id?: string
          is_passing?: boolean
          min_percent: number
          name: string
          org_id?: string | null
          scale_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          id?: string
          is_passing?: boolean
          min_percent?: number
          name?: string
          org_id?: string | null
          scale_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_levels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_levels_scale_id_fkey"
            columns: ["scale_id"]
            isOneToOne: false
            referencedRelation: "grade_scales"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_scales: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_scales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      grading_jobs: {
        Row: {
          created_at: string
          error: string | null
          error_message: string | null
          exam_id: string | null
          id: string
          org_id: string
          progress: number
          requested_by: string | null
          result_status: string | null
          result_total: number | null
          session_id: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          error_message?: string | null
          exam_id?: string | null
          id?: string
          org_id: string
          progress?: number
          requested_by?: string | null
          result_status?: string | null
          result_total?: number | null
          session_id?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          error_message?: string | null
          exam_id?: string | null
          id?: string
          org_id?: string
          progress?: number
          requested_by?: string | null
          result_status?: string | null
          result_total?: number | null
          session_id?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grading_jobs_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grading_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiries: {
        Row: {
          company: string
          contact_name: string | null
          created_at: string
          email: string | null
          headcount: string | null
          id: string
          inquiry_type: string | null
          message: string | null
          notion_page_id: string | null
          org_id: string | null
          phone: string | null
          source: string | null
          status: string
          timeframe: string | null
        }
        Insert: {
          company: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          headcount?: string | null
          id?: string
          inquiry_type?: string | null
          message?: string | null
          notion_page_id?: string | null
          org_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          timeframe?: string | null
        }
        Update: {
          company?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          headcount?: string | null
          id?: string
          inquiry_type?: string | null
          message?: string | null
          notion_page_id?: string | null
          org_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          timeframe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitoring_events: {
        Row: {
          created_at: string
          detected_at: string
          event_type: string
          id: string
          is_reviewed: boolean
          org_id: string
          question_index: number | null
          reviewer_note: string | null
          screenshot_url: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          detected_at?: string
          event_type: string
          id?: string
          is_reviewed?: boolean
          org_id: string
          question_index?: number | null
          reviewer_note?: string | null
          screenshot_url?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          detected_at?: string
          event_type?: string
          id?: string
          is_reviewed?: boolean
          org_id?: string
          question_index?: number | null
          reviewer_note?: string | null
          screenshot_url?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitoring_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_agent_skills: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_agent_skills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_branding: {
        Row: {
          cert_template: Json
          created_at: string
          custom_domain: string | null
          email_from_address: string | null
          email_from_name: string | null
          email_subject_prefix: string | null
          footer_org: string | null
          logo_url: string | null
          org_id: string
          primary_color: string | null
          site_subtitle: string | null
          site_title: string | null
          updated_at: string
        }
        Insert: {
          cert_template?: Json
          created_at?: string
          custom_domain?: string | null
          email_from_address?: string | null
          email_from_name?: string | null
          email_subject_prefix?: string | null
          footer_org?: string | null
          logo_url?: string | null
          org_id: string
          primary_color?: string | null
          site_subtitle?: string | null
          site_title?: string | null
          updated_at?: string
        }
        Update: {
          cert_template?: Json
          created_at?: string
          custom_domain?: string | null
          email_from_address?: string | null
          email_from_name?: string | null
          email_subject_prefix?: string | null
          footer_org?: string | null
          logo_url?: string | null
          org_id?: string
          primary_color?: string | null
          site_subtitle?: string | null
          site_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_branding_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_mcp_servers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          secret_env: string | null
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          secret_env?: string | null
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          secret_env?: string | null
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_mcp_servers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          department: string | null
          display_name: string | null
          employee_no: string | null
          invited_by: string | null
          joined_at: string
          org_id: string
          position: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          department?: string | null
          display_name?: string | null
          employee_no?: string | null
          invited_by?: string | null
          joined_at?: string
          org_id: string
          position?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          department?: string | null
          display_name?: string | null
          employee_no?: string | null
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          biz_reg_no: string | null
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          biz_reg_no?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          biz_reg_no?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          code: string
          created_at: string
          currency: string
          features: Json
          id: string
          is_active: boolean
          max_exams_monthly: number | null
          max_members: number | null
          name: string
          price_monthly: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_exams_monthly?: number | null
          max_members?: number | null
          name: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_exams_monthly?: number | null
          max_members?: number | null
          name?: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          id: string
          name: string | null
          organization: string | null
          phone: string | null
          position: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          id: string
          name?: string | null
          organization?: string | null
          phone?: string | null
          position?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          id?: string
          name?: string | null
          organization?: string | null
          phone?: string | null
          position?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      question_competencies: {
        Row: {
          competency_id: string
          created_at: string
          org_id: string | null
          question_id: string
          weight: number
        }
        Insert: {
          competency_id: string
          created_at?: string
          org_id?: string | null
          question_id: string
          weight?: number
        }
        Update: {
          competency_id?: string
          created_at?: string
          org_id?: string | null
          question_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_competencies_competency_id_fkey"
            columns: ["competency_id"]
            isOneToOne: false
            referencedRelation: "competencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_competencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_competencies_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_competencies_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
        ]
      }
      question_fixtures: {
        Row: {
          content: string
          created_at: string
          id: string
          mime_type: string
          org_id: string | null
          path: string
          question_id: string
          sort_order: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mime_type?: string
          org_id?: string | null
          path: string
          question_id: string
          sort_order?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mime_type?: string
          org_id?: string | null
          path?: string
          question_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_fixtures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_fixtures_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_fixtures_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
        ]
      }
      question_licenses: {
        Row: {
          expires_at: string | null
          granted_at: string
          note: string | null
          org_id: string
          set_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          note?: string | null
          org_id: string
          set_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          note?: string | null
          org_id?: string
          set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_licenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_licenses_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      question_set_items: {
        Row: {
          created_at: string
          org_id: string | null
          points_override: number | null
          question_id: string
          set_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          org_id?: string | null
          points_override?: number | null
          question_id: string
          set_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          org_id?: string | null
          points_override?: number | null
          question_id?: string
          set_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_set_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_set_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_set_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_set_items_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          attachments: Json
          category: string | null
          code: string
          created_at: string
          description: string | null
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          grade: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
          proctoring_disabled: boolean
          tags: Json
          updated_at: string
          visibility: Database["public"]["Enums"]["question_visibility"]
        }
        Insert: {
          attachments?: Json
          category?: string | null
          code: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          grade?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
          proctoring_disabled?: boolean
          tags?: Json
          updated_at?: string
          visibility?: Database["public"]["Enums"]["question_visibility"]
        }
        Update: {
          attachments?: Json
          category?: string | null
          code?: string
          created_at?: string
          description?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          grade?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
          proctoring_disabled?: boolean
          tags?: Json
          updated_at?: string
          visibility?: Database["public"]["Enums"]["question_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "question_sets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          answer_key: Json
          attachments: Json
          code: string | null
          content: string
          created_at: string
          created_by: string | null
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          id: string
          is_active: boolean
          org_id: string | null
          points: number
          rubric: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
          visibility: Database["public"]["Enums"]["question_visibility"]
        }
        Insert: {
          answer_key?: Json
          attachments?: Json
          code?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          id?: string
          is_active?: boolean
          org_id?: string | null
          points?: number
          rubric?: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["question_visibility"]
        }
        Update: {
          answer_key?: Json
          attachments?: Json
          code?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          id?: string
          is_active?: boolean
          org_id?: string | null
          points?: number
          rubric?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["question_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recording_chunks: {
        Row: {
          applicant_id: string | null
          chunk_index: number
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          exam_id: string | null
          id: string
          is_header: boolean | null
          kind: string
          mime_type: string | null
          object_key: string
          org_id: string
          session_id: string
          size_bytes: number | null
          started_at: string
        }
        Insert: {
          applicant_id?: string | null
          chunk_index: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          exam_id?: string | null
          id?: string
          is_header?: boolean | null
          kind: string
          mime_type?: string | null
          object_key: string
          org_id: string
          session_id: string
          size_bytes?: number | null
          started_at?: string
        }
        Update: {
          applicant_id?: string | null
          chunk_index?: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          exam_id?: string | null
          id?: string
          is_header?: boolean | null
          kind?: string
          mime_type?: string | null
          object_key?: string
          org_id?: string
          session_id?: string
          size_bytes?: number | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recording_chunks_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_chunks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_chunks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      recording_diagnostics: {
        Row: {
          applicant_id: string | null
          at: string
          created_at: string
          id: string
          kind: string | null
          message: string | null
          meta: Json | null
          org_id: string
          session_id: string
          stage: string
          status: Database["public"]["Enums"]["recording_diag_status"]
        }
        Insert: {
          applicant_id?: string | null
          at?: string
          created_at?: string
          id?: string
          kind?: string | null
          message?: string | null
          meta?: Json | null
          org_id: string
          session_id: string
          stage: string
          status?: Database["public"]["Enums"]["recording_diag_status"]
        }
        Update: {
          applicant_id?: string | null
          at?: string
          created_at?: string
          id?: string
          kind?: string | null
          message?: string | null
          meta?: Json | null
          org_id?: string
          session_id?: string
          stage?: string
          status?: Database["public"]["Enums"]["recording_diag_status"]
        }
        Relationships: [
          {
            foreignKeyName: "recording_diagnostics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_diagnostics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_otp_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          session_id: string
          verified: boolean
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          session_id: string
          verified?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          session_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_ref: string | null
          id: string
          org_id: string
          plan_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_ref?: string | null
          id?: string
          org_id: string
          plan_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_ref?: string | null
          id?: string
          org_id?: string
          plan_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          org_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          org_id: string
          quantity?: number
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      questions_public: {
        Row: {
          attachments: Json | null
          content: string | null
          created_at: string | null
          difficulty: Database["public"]["Enums"]["question_difficulty"] | null
          id: string | null
          is_active: boolean | null
          org_id: string | null
          points: number | null
          prompt_data: Json | null
          type: Database["public"]["Enums"]["question_type"] | null
          visibility: Database["public"]["Enums"]["question_visibility"] | null
        }
        Insert: {
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          id?: string | null
          is_active?: boolean | null
          org_id?: string | null
          points?: number | null
          prompt_data?: never
          type?: Database["public"]["Enums"]["question_type"] | null
          visibility?: Database["public"]["Enums"]["question_visibility"] | null
        }
        Update: {
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"] | null
          id?: string | null
          is_active?: boolean | null
          org_id?: string | null
          points?: number | null
          prompt_data?: never
          type?: Database["public"]["Enums"]["question_type"] | null
          visibility?: Database["public"]["Enums"]["question_visibility"] | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_org_invitation: { Args: { _token: string }; Returns: string }
      can_read_licensed_question: {
        Args: { _question_id: string }
        Returns: boolean
      }
      clone_framework_to_org: {
        Args: {
          _framework_id: string
          _new_code: string
          _new_name: string
          _org_id: string
        }
        Returns: string
      }
      create_org_invitation: {
        Args: {
          _email: string
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: {
          biz_reg_no: string | null
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_agent_workspace: { Args: { _agent_id: string }; Returns: Json }
      get_exam_question_tools: {
        Args: { _session_id: string }
        Returns: {
          meta: Json
          question_id: string
          tool_req: string
        }[]
      }
      get_exam_questions_for_session: {
        Args: { _session_id: string }
        Returns: {
          allow_file_upload: boolean
          attachments: Json
          category: string
          content: string
          correct_answer: string
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          exam_id: string
          grade: string
          id: string
          max_score: number
          options: Json
          order_num: number
          set_id: string
          tags: Json
          type: Database["public"]["Enums"]["question_type"]
        }[]
      }
      get_invitation_by_code: {
        Args: { p_code: string }
        Returns: {
          email: string
          exam_id: string
          exam_title: string
          has_active_session: boolean
          id: string
          invite_code: string
          is_test_mode: boolean
          is_used: boolean
          name: string
        }[]
      }
      get_question_fixtures: {
        Args: { _session_id: string }
        Returns: {
          content: string
          mime_type: string
          path: string
          question_id: string
        }[]
      }
      get_server_time: { Args: never; Returns: string }
      get_user_emails: {
        Args: never
        Returns: {
          email: string
          id: string
        }[]
      }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_examiner: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      org_has_question_license: { Args: { _set_id: string }; Returns: boolean }
      redeem_exam_invitation: { Args: { _code: string }; Returns: string }
      revoke_org_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      storage_is_session_applicant: {
        Args: { _session_id: string }
        Returns: boolean
      }
      storage_session_org: { Args: { _session_id: string }; Returns: string }
      storage_session_writable: {
        Args: { _session_id: string }
        Returns: boolean
      }
      user_org_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      app_role: "org_owner" | "org_admin" | "examiner" | "applicant" | "viewer"
      cert_status: "valid" | "revoked"
      exam_status: "draft" | "open" | "closed"
      member_status: "invited" | "active" | "suspended"
      monitoring_event_type:
        | "face_missing"
        | "multiple_faces"
        | "tab_switch"
        | "screen_share_off"
      org_status: "trial" | "active" | "suspended" | "cancelled"
      question_difficulty: "easy" | "medium" | "hard"
      question_type:
        | "multiple_choice"
        | "short_answer"
        | "essay"
        | "file_upload"
        | "work_based"
      question_visibility: "platform" | "licensed" | "org"
      recording_diag_status: "info" | "success" | "warn" | "error"
      registration_mode: "open" | "invite_only" | "hybrid"
      session_status:
        | "waiting"
        | "in_progress"
        | "submitted"
        | "passed"
        | "failed"
      sub_status: "trialing" | "active" | "past_due" | "cancelled"
      usage_kind: "exam_session" | "ai_grading" | "recording_gb"
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
    Enums: {
      app_role: ["org_owner", "org_admin", "examiner", "applicant", "viewer"],
      cert_status: ["valid", "revoked"],
      exam_status: ["draft", "open", "closed"],
      member_status: ["invited", "active", "suspended"],
      monitoring_event_type: [
        "face_missing",
        "multiple_faces",
        "tab_switch",
        "screen_share_off",
      ],
      org_status: ["trial", "active", "suspended", "cancelled"],
      question_difficulty: ["easy", "medium", "hard"],
      question_type: [
        "multiple_choice",
        "short_answer",
        "essay",
        "file_upload",
        "work_based",
      ],
      question_visibility: ["platform", "licensed", "org"],
      recording_diag_status: ["info", "success", "warn", "error"],
      registration_mode: ["open", "invite_only", "hybrid"],
      session_status: [
        "waiting",
        "in_progress",
        "submitted",
        "passed",
        "failed",
      ],
      sub_status: ["trialing", "active", "past_due", "cancelled"],
      usage_kind: ["exam_session", "ai_grading", "recording_gb"],
    },
  },
} as const
