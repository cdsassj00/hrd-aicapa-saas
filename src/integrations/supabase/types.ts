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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      org_branding: {
        Row: {
          cert_template: Json
          created_at: string
          custom_domain: string | null
          logo_url: string | null
          org_id: string
          primary_color: string | null
          updated_at: string
        }
        Insert: {
          cert_template?: Json
          created_at?: string
          custom_domain?: string | null
          logo_url?: string | null
          org_id: string
          primary_color?: string | null
          updated_at?: string
        }
        Update: {
          cert_template?: Json
          created_at?: string
          custom_domain?: string | null
          logo_url?: string | null
          org_id?: string
          primary_color?: string | null
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
            foreignKeyName: "org_members_profiles_fk"
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
      platform_admins: {
        Row: { created_at: string; note: string | null; user_id: string }
        Insert: { created_at?: string; note?: string | null; user_id: string }
        Update: { created_at?: string; note?: string | null; user_id?: string }
        Relationships: []
      }
      active_sessions: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          session_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          session_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          session_token?: string
          user_id?: string
        }
        Relationships: []
      }
      answers: {
        Row: {
          content: string
          created_at: string
          feedback: string | null
          file_url: string | null
          id: string
          question_id: string
          score: number | null
          session_id: string
          slot_scores: Json | null
          slot_values: Json | null
          submitted_at: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          feedback?: string | null
          file_url?: string | null
          id?: string
          question_id: string
          score?: number | null
          session_id: string
          slot_scores?: Json | null
          slot_values?: Json | null
          submitted_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          feedback?: string | null
          file_url?: string | null
          id?: string
          question_id?: string
          score?: number | null
          session_id?: string
          slot_scores?: Json | null
          slot_values?: Json | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
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
      certifications: {
        Row: {
          applicant_id: string
          cert_number: string
          created_at: string
          exam_id: string
          grade: Database["public"]["Enums"]["exam_grade"]
          id: string
          issued_at: string
          session_id: string
          status: Database["public"]["Enums"]["cert_status"]
        }
        Insert: {
          applicant_id: string
          cert_number: string
          created_at?: string
          exam_id: string
          grade: Database["public"]["Enums"]["exam_grade"]
          id?: string
          issued_at?: string
          session_id: string
          status?: Database["public"]["Enums"]["cert_status"]
        }
        Update: {
          applicant_id?: string
          cert_number?: string
          created_at?: string
          exam_id?: string
          grade?: Database["public"]["Enums"]["exam_grade"]
          id?: string
          issued_at?: string
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
            foreignKeyName: "certifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_announcements: {
        Row: {
          created_at: string | null
          exam_id: string
          id: string
          message: string
          sender_id: string
        }
        Insert: {
          created_at?: string | null
          exam_id: string
          id?: string
          message: string
          sender_id: string
        }
        Update: {
          created_at?: string | null
          exam_id?: string
          id?: string
          message?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_announcements_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_chat_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_id: string
          sender_role: string
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_id: string
          sender_role?: string
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_id?: string
          sender_role?: string
          session_id?: string
        }
        Relationships: [
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
          allow_dual_monitor: boolean
          allow_no_screen_share: boolean
          allow_no_webcam: boolean
          created_at: string
          email: string
          exam_id: string
          exemption_reason: string | null
          id: string
          invite_code: string
          is_used: boolean
          name: string
          session_id: string | null
        }
        Insert: {
          allow_dual_monitor?: boolean
          allow_no_screen_share?: boolean
          allow_no_webcam?: boolean
          created_at?: string
          email: string
          exam_id: string
          exemption_reason?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean
          name?: string
          session_id?: string | null
        }
        Update: {
          allow_dual_monitor?: boolean
          allow_no_screen_share?: boolean
          allow_no_webcam?: boolean
          created_at?: string
          email?: string
          exam_id?: string
          exemption_reason?: string | null
          id?: string
          invite_code?: string
          is_used?: boolean
          name?: string
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
          question_id: string
        }
        Insert: {
          created_at?: string
          exam_id: string
          id?: string
          order_num?: number
          question_id: string
        }
        Update: {
          created_at?: string
          exam_id?: string
          id?: string
          order_num?: number
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
            foreignKeyName: "exam_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sessions: {
        Row: {
          applicant_id: string
          created_at: string
          exam_id: string
          id: string
          id_card_url: string | null
          is_flagged: boolean
          monitoring_notes: string | null
          phase1_completed_at: string | null
          score_total: number | null
          start_time: string | null
          status: Database["public"]["Enums"]["session_status"]
          submit_reason: string | null
          submit_time: string | null
          updated_at: string
          zoom_host_url: string | null
          zoom_join_url: string | null
          zoom_meeting_id: string | null
        }
        Insert: {
          applicant_id: string
          created_at?: string
          exam_id: string
          id?: string
          id_card_url?: string | null
          is_flagged?: boolean
          monitoring_notes?: string | null
          phase1_completed_at?: string | null
          score_total?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          submit_reason?: string | null
          submit_time?: string | null
          updated_at?: string
          zoom_host_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Update: {
          applicant_id?: string
          created_at?: string
          exam_id?: string
          id?: string
          id_card_url?: string | null
          is_flagged?: boolean
          monitoring_notes?: string | null
          phase1_completed_at?: string | null
          score_total?: number | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["session_status"]
          submit_reason?: string | null
          submit_time?: string | null
          updated_at?: string
          zoom_host_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_sessions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          alert_event_types: string[]
          allow_dual_monitor: boolean
          block_late_entry: boolean
          created_at: string
          custom_texts: Json
          daily_room_name: string | null
          daily_room_url: string | null
          duration_minutes: number
          entry_start_minutes: number
          exam_date: string
          grade: Database["public"]["Enums"]["exam_grade"]
          id: string
          instructions: string | null
          is_test_mode: boolean
          late_entry_minutes: number
          max_participants: number
          pass_score: number
          phase1_minutes: number
          phased_enabled: boolean
          registration_mode: Database["public"]["Enums"]["registration_mode"]
          skip_face_match: boolean
          skip_waiting_checks: boolean
          status: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at: string
          use_absolute_end: boolean | null
          zoom_host_url: string | null
          zoom_join_url: string | null
          zoom_meeting_id: string | null
        }
        Insert: {
          alert_event_types?: string[]
          allow_dual_monitor?: boolean
          block_late_entry?: boolean
          created_at?: string
          custom_texts?: Json
          daily_room_name?: string | null
          daily_room_url?: string | null
          duration_minutes?: number
          entry_start_minutes?: number
          exam_date: string
          grade: Database["public"]["Enums"]["exam_grade"]
          id?: string
          instructions?: string | null
          is_test_mode?: boolean
          late_entry_minutes?: number
          max_participants?: number
          pass_score?: number
          phase1_minutes?: number
          phased_enabled?: boolean
          registration_mode?: Database["public"]["Enums"]["registration_mode"]
          skip_face_match?: boolean
          skip_waiting_checks?: boolean
          status?: Database["public"]["Enums"]["exam_status"]
          title: string
          updated_at?: string
          use_absolute_end?: boolean | null
          zoom_host_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Update: {
          alert_event_types?: string[]
          allow_dual_monitor?: boolean
          block_late_entry?: boolean
          created_at?: string
          custom_texts?: Json
          daily_room_name?: string | null
          daily_room_url?: string | null
          duration_minutes?: number
          entry_start_minutes?: number
          exam_date?: string
          grade?: Database["public"]["Enums"]["exam_grade"]
          id?: string
          instructions?: string | null
          is_test_mode?: boolean
          late_entry_minutes?: number
          max_participants?: number
          pass_score?: number
          phase1_minutes?: number
          phased_enabled?: boolean
          registration_mode?: Database["public"]["Enums"]["registration_mode"]
          skip_face_match?: boolean
          skip_waiting_checks?: boolean
          status?: Database["public"]["Enums"]["exam_status"]
          title?: string
          updated_at?: string
          use_absolute_end?: boolean | null
          zoom_host_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: string | null
        }
        Relationships: []
      }
      grading_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          progress: number
          result_status: string | null
          result_total: number | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          progress?: number
          result_status?: string | null
          result_total?: number | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          progress?: number
          result_status?: string | null
          result_total?: number | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      monitoring_events: {
        Row: {
          created_at: string
          detected_at: string
          event_type: Database["public"]["Enums"]["monitoring_event_type"]
          id: string
          is_reviewed: boolean
          question_index: number | null
          reviewer_note: string | null
          screenshot_url: string | null
          session_id: string
        }
        Insert: {
          created_at?: string
          detected_at?: string
          event_type: Database["public"]["Enums"]["monitoring_event_type"]
          id?: string
          is_reviewed?: boolean
          question_index?: number | null
          reviewer_note?: string | null
          screenshot_url?: string | null
          session_id: string
        }
        Update: {
          created_at?: string
          detected_at?: string
          event_type?: Database["public"]["Enums"]["monitoring_event_type"]
          id?: string
          is_reviewed?: boolean
          question_index?: number | null
          reviewer_note?: string | null
          screenshot_url?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          department: string | null
          id: string
          name: string
          organization: string | null
          phone: string | null
          position: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          id: string
          name?: string
          organization?: string | null
          phone?: string | null
          position?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          id?: string
          name?: string
          organization?: string | null
          phone?: string | null
          position?: string | null
        }
        Relationships: []
      }
      question_logs: {
        Row: {
          action: string
          actor_id: string
          changes: Json | null
          created_at: string
          id: string
          question_id: string
        }
        Insert: {
          action: string
          actor_id: string
          changes?: Json | null
          created_at?: string
          id?: string
          question_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          changes?: Json | null
          created_at?: string
          id?: string
          question_id?: string
        }
        Relationships: []
      }
      question_sets: {
        Row: {
          attachments: Json
          category: Database["public"]["Enums"]["question_category"] | null
          created_at: string
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          exam_id: string | null
          grade: Database["public"]["Enums"]["exam_grade"] | null
          id: string
          order_num: number
          proctoring_disabled: boolean
          scenario: string
          tags: string[]
          title: string
          total_score: number
          updated_at: string
        }
        Insert: {
          attachments?: Json
          category?: Database["public"]["Enums"]["question_category"] | null
          created_at?: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          exam_id?: string | null
          grade?: Database["public"]["Enums"]["exam_grade"] | null
          id?: string
          order_num?: number
          proctoring_disabled?: boolean
          scenario?: string
          tags?: string[]
          title?: string
          total_score?: number
          updated_at?: string
        }
        Update: {
          attachments?: Json
          category?: Database["public"]["Enums"]["question_category"] | null
          created_at?: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          exam_id?: string | null
          grade?: Database["public"]["Enums"]["exam_grade"] | null
          id?: string
          order_num?: number
          proctoring_disabled?: boolean
          scenario?: string
          tags?: string[]
          title?: string
          total_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          allow_file_upload: boolean
          attachments: Json | null
          category: Database["public"]["Enums"]["question_category"]
          code: string | null
          content: string
          correct_answer: string | null
          created_at: string
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          exam_id: string | null
          grade: Database["public"]["Enums"]["exam_grade"] | null
          id: string
          max_score: number
          options: Json | null
          order_num: number
          set_id: string | null
          set_order: number | null
          submission_slots: Json | null
          tags: string[]
          type: string
        }
        Insert: {
          allow_file_upload?: boolean
          attachments?: Json | null
          category: Database["public"]["Enums"]["question_category"]
          code?: string | null
          content: string
          correct_answer?: string | null
          created_at?: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          exam_id?: string | null
          grade?: Database["public"]["Enums"]["exam_grade"] | null
          id?: string
          max_score?: number
          options?: Json | null
          order_num?: number
          set_id?: string | null
          set_order?: number | null
          submission_slots?: Json | null
          tags?: string[]
          type?: string
        }
        Update: {
          allow_file_upload?: boolean
          attachments?: Json | null
          category?: Database["public"]["Enums"]["question_category"]
          code?: string | null
          content?: string
          correct_answer?: string | null
          created_at?: string
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          exam_id?: string | null
          grade?: Database["public"]["Enums"]["exam_grade"] | null
          id?: string
          max_score?: number
          options?: Json | null
          order_num?: number
          set_id?: string | null
          set_order?: number | null
          submission_slots?: Json | null
          tags?: string[]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      recording_chunks: {
        Row: {
          applicant_id: string
          chunk_index: number
          created_at: string
          duration_ms: number | null
          ended_at: string | null
          exam_id: string
          id: string
          is_header: boolean | null
          kind: string
          mime_type: string | null
          object_key: string
          session_id: string
          size_bytes: number | null
          started_at: string
        }
        Insert: {
          applicant_id: string
          chunk_index: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          exam_id: string
          id?: string
          is_header?: boolean | null
          kind: string
          mime_type?: string | null
          object_key: string
          session_id: string
          size_bytes?: number | null
          started_at?: string
        }
        Update: {
          applicant_id?: string
          chunk_index?: number
          created_at?: string
          duration_ms?: number | null
          ended_at?: string | null
          exam_id?: string
          id?: string
          is_header?: boolean | null
          kind?: string
          mime_type?: string | null
          object_key?: string
          session_id?: string
          size_bytes?: number | null
          started_at?: string
        }
        Relationships: [
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
          applicant_id: string
          at: string
          created_at: string
          id: string
          kind: string | null
          message: string | null
          meta: Json | null
          session_id: string
          stage: Database["public"]["Enums"]["recording_diag_stage"]
          status: Database["public"]["Enums"]["recording_diag_status"]
        }
        Insert: {
          applicant_id: string
          at?: string
          created_at?: string
          id?: string
          kind?: string | null
          message?: string | null
          meta?: Json | null
          session_id: string
          stage: Database["public"]["Enums"]["recording_diag_stage"]
          status?: Database["public"]["Enums"]["recording_diag_status"]
        }
        Update: {
          applicant_id?: string
          at?: string
          created_at?: string
          id?: string
          kind?: string | null
          message?: string | null
          meta?: Json | null
          session_id?: string
          stage?: Database["public"]["Enums"]["recording_diag_stage"]
          status?: Database["public"]["Enums"]["recording_diag_status"]
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
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
      user_actions: {
        Row: {
          action_type: string
          created_at: string
          id: string
          metadata: Json
          session_id: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          metadata?: Json
          session_id?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_org_invitation: { Args: { _token: string }; Returns: string }
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
      }
      has_org_role: {
        Args: { _org_id: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      revoke_org_invitation: { Args: { _invitation_id: string }; Returns: undefined }
      user_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      auto_timeout_expired_sessions: { Args: never; Returns: number }
      get_exam_questions_for_session: {
        Args: { _session_id: string }
        Returns: {
          allow_file_upload: boolean
          attachments: Json
          category: Database["public"]["Enums"]["question_category"]
          content: string
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          exam_id: string
          grade: Database["public"]["Enums"]["exam_grade"]
          id: string
          max_score: number
          options: Json
          order_num: number
          set_id: string
          set_order: number
          submission_slots: Json
          tags: string[]
          type: string
        }[]
      }
      get_invitation_by_code: {
        Args: { p_code: string }
        Returns: {
          email: string
          exam_title: string
          has_active_session: boolean
          invite_code: string
          is_test_mode: boolean
          is_used: boolean
          name: string
        }[]
      }
      get_server_time: { Args: never; Returns: string }
      get_user_emails: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "org_owner" | "org_admin" | "examiner" | "applicant" | "viewer"
      member_status: "invited" | "active" | "suspended"
      org_status: "trial" | "active" | "suspended" | "cancelled"
      question_visibility: "platform" | "licensed" | "org"
      sub_status: "trialing" | "active" | "past_due" | "cancelled"
      usage_kind: "exam_session" | "ai_grading" | "recording_gb"
      cert_status: "valid" | "revoked"
      exam_grade: "green" | "blue" | "black" | "전문인재"
      exam_status: "draft" | "open" | "closed"
      monitoring_event_type:
        | "face_missing"
        | "multiple_faces"
        | "tab_switch"
        | "screen_share_off"
        | "voice_detected"
        | "window_blur"
        | "screen_share_picker"
      question_category: "생성형AI활용" | "데이터분석" | "서비스구현"
      question_difficulty: "easy" | "medium" | "hard"
      recording_diag_stage:
        | "init"
        | "media_request"
        | "recorder_start"
        | "recorder_stop"
        | "chunk_emitted"
        | "presign"
        | "upload"
        | "db_insert"
        | "session_end"
      recording_diag_status: "info" | "success" | "warn" | "error"
      registration_mode: "open" | "invite_only" | "hybrid"
      session_status:
        | "waiting"
        | "in_progress"
        | "submitted"
        | "passed"
        | "failed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      member_status: ["invited", "active", "suspended"],
      org_status: ["trial", "active", "suspended", "cancelled"],
      question_visibility: ["platform", "licensed", "org"],
      sub_status: ["trialing", "active", "past_due", "cancelled"],
      usage_kind: ["exam_session", "ai_grading", "recording_gb"],
      cert_status: ["valid", "revoked"],
      exam_grade: ["green", "blue", "black", "전문인재"],
      exam_status: ["draft", "open", "closed"],
      monitoring_event_type: [
        "face_missing",
        "multiple_faces",
        "tab_switch",
        "screen_share_off",
        "voice_detected",
        "window_blur",
        "screen_share_picker",
      ],
      question_category: ["생성형AI활용", "데이터분석", "서비스구현"],
      question_difficulty: ["easy", "medium", "hard"],
      recording_diag_stage: [
        "init",
        "media_request",
        "recorder_start",
        "recorder_stop",
        "chunk_emitted",
        "presign",
        "upload",
        "db_insert",
        "session_end",
      ],
      recording_diag_status: ["info", "success", "warn", "error"],
      registration_mode: ["open", "invite_only", "hybrid"],
      session_status: [
        "waiting",
        "in_progress",
        "submitted",
        "passed",
        "failed",
      ],
    },
  },
} as const
