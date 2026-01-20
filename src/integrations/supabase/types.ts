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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      batch_job_events: {
        Row: {
          batch_job_id: string
          id: string
          item_id: string | null
          message: string
          owner_id: string
          progress_int: number
          ts: string
          type: string
        }
        Insert: {
          batch_job_id: string
          id?: string
          item_id?: string | null
          message: string
          owner_id: string
          progress_int?: number
          ts?: string
          type: string
        }
        Update: {
          batch_job_id?: string
          id?: string
          item_id?: string | null
          message?: string
          owner_id?: string
          progress_int?: number
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_job_events_batch_job_id_fkey"
            columns: ["batch_job_id"]
            isOneToOne: false
            referencedRelation: "batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_job_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "batch_jobs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_jobs: {
        Row: {
          base_prompt: string | null
          change_request: string
          completed_items: number | null
          created_at: string | null
          failed_items: number | null
          id: string
          last_error: string | null
          output_resolution: string | null
          owner_id: string
          progress_int: number | null
          project_id: string
          status: string
          style_profile: Json | null
          total_items: number | null
          updated_at: string | null
        }
        Insert: {
          base_prompt?: string | null
          change_request: string
          completed_items?: number | null
          created_at?: string | null
          failed_items?: number | null
          id?: string
          last_error?: string | null
          output_resolution?: string | null
          owner_id: string
          progress_int?: number | null
          project_id: string
          status?: string
          style_profile?: Json | null
          total_items?: number | null
          updated_at?: string | null
        }
        Update: {
          base_prompt?: string | null
          change_request?: string
          completed_items?: number | null
          created_at?: string | null
          failed_items?: number | null
          id?: string
          last_error?: string | null
          output_resolution?: string | null
          owner_id?: string
          progress_int?: number | null
          project_id?: string
          status?: string
          style_profile?: Json | null
          total_items?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_jobs_items: {
        Row: {
          attempt_number: number | null
          batch_job_id: string
          created_at: string | null
          id: string
          last_error: string | null
          output_upload_id: string | null
          owner_id: string
          panorama_upload_id: string
          qa_decision: string | null
          qa_reason: string | null
          render_job_id: string | null
          status: string
        }
        Insert: {
          attempt_number?: number | null
          batch_job_id: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          output_upload_id?: string | null
          owner_id: string
          panorama_upload_id: string
          qa_decision?: string | null
          qa_reason?: string | null
          render_job_id?: string | null
          status?: string
        }
        Update: {
          attempt_number?: number | null
          batch_job_id?: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          output_upload_id?: string | null
          owner_id?: string
          panorama_upload_id?: string
          qa_decision?: string | null
          qa_reason?: string | null
          render_job_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_jobs_items_batch_job_id_fkey"
            columns: ["batch_job_id"]
            isOneToOne: false
            referencedRelation: "batch_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_jobs_items_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_jobs_items_panorama_upload_id_fkey"
            columns: ["panorama_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_jobs_items_render_job_id_fkey"
            columns: ["render_job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      change_suggestions: {
        Row: {
          category: string
          created_at: string
          id: string
          is_generated: boolean
          prompt: string
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_generated?: boolean
          prompt: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_generated?: boolean
          prompt?: string
          title?: string
        }
        Relationships: []
      }
      floorplan_pipeline_events: {
        Row: {
          id: string
          message: string
          owner_id: string
          pipeline_id: string
          progress_int: number
          step_number: number
          ts: string
          type: string
        }
        Insert: {
          id?: string
          message: string
          owner_id: string
          pipeline_id: string
          progress_int?: number
          step_number: number
          ts?: string
          type: string
        }
        Update: {
          id?: string
          message?: string
          owner_id?: string
          pipeline_id?: string
          progress_int?: number
          step_number?: number
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_pipeline_events_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_pipeline_reviews: {
        Row: {
          created_at: string
          decision: string
          id: string
          notes: string | null
          owner_id: string
          pipeline_id: string
          step_number: number
        }
        Insert: {
          created_at?: string
          decision: string
          id?: string
          notes?: string | null
          owner_id: string
          pipeline_id: string
          step_number: number
        }
        Update: {
          created_at?: string
          decision?: string
          id?: string
          notes?: string | null
          owner_id?: string
          pipeline_id?: string
          step_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_pipeline_reviews_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_pipelines: {
        Row: {
          aspect_ratio: string | null
          camera_position: string | null
          created_at: string
          current_step: number
          floor_plan_upload_id: string
          forward_direction: string | null
          id: string
          last_error: string | null
          output_resolution: string | null
          owner_id: string
          project_id: string
          status: string
          step_outputs: Json | null
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string | null
          camera_position?: string | null
          created_at?: string
          current_step?: number
          floor_plan_upload_id: string
          forward_direction?: string | null
          id?: string
          last_error?: string | null
          output_resolution?: string | null
          owner_id: string
          project_id: string
          status?: string
          step_outputs?: Json | null
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string | null
          camera_position?: string | null
          created_at?: string
          current_step?: number
          floor_plan_upload_id?: string
          forward_direction?: string | null
          id?: string
          last_error?: string | null
          output_resolution?: string | null
          owner_id?: string
          project_id?: string
          status?: string
          step_outputs?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_pipelines_floor_plan_upload_id_fkey"
            columns: ["floor_plan_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_pipelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      image_edit_job_events: {
        Row: {
          id: string
          job_id: string
          message: string
          owner_id: string
          progress_int: number | null
          ts: string
          type: string
        }
        Insert: {
          id?: string
          job_id: string
          message: string
          owner_id: string
          progress_int?: number | null
          ts?: string
          type: string
        }
        Update: {
          id?: string
          job_id?: string
          message?: string
          owner_id?: string
          progress_int?: number | null
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_edit_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "image_edit_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      image_edit_jobs: {
        Row: {
          aspect_ratio: string | null
          change_description: string
          created_at: string
          id: string
          last_error: string | null
          output_quality: string | null
          output_upload_id: string | null
          owner_id: string
          progress_int: number | null
          progress_message: string | null
          project_id: string
          source_upload_id: string
          status: string
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string | null
          change_description: string
          created_at?: string
          id?: string
          last_error?: string | null
          output_quality?: string | null
          output_upload_id?: string | null
          owner_id: string
          progress_int?: number | null
          progress_message?: string | null
          project_id: string
          source_upload_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string | null
          change_description?: string
          created_at?: string
          id?: string
          last_error?: string | null
          output_quality?: string | null
          output_upload_id?: string | null
          owner_id?: string
          progress_int?: number | null
          progress_message?: string | null
          project_id?: string
          source_upload_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_edit_jobs_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_edit_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_edit_jobs_source_upload_id_fkey"
            columns: ["source_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      job_reviews: {
        Row: {
          created_at: string | null
          decision: string
          id: string
          job_id: string
          notes: string | null
          owner_id: string
        }
        Insert: {
          created_at?: string | null
          decision: string
          id?: string
          job_id: string
          notes?: string | null
          owner_id: string
        }
        Update: {
          created_at?: string | null
          decision?: string
          id?: string
          job_id?: string
          notes?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_image_panorama_events: {
        Row: {
          id: string
          job_id: string
          message: string
          owner_id: string
          progress_int: number | null
          ts: string
          type: string
        }
        Insert: {
          id?: string
          job_id: string
          message: string
          owner_id: string
          progress_int?: number | null
          ts?: string
          type: string
        }
        Update: {
          id?: string
          job_id?: string
          message?: string
          owner_id?: string
          progress_int?: number | null
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "multi_image_panorama_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "multi_image_panorama_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_image_panorama_jobs: {
        Row: {
          aspect_ratio: string | null
          camera_position: string | null
          created_at: string
          forward_direction: string | null
          id: string
          input_upload_ids: Json
          last_error: string | null
          output_resolution: string | null
          output_upload_id: string | null
          owner_id: string
          progress_int: number | null
          progress_message: string | null
          project_id: string
          prompt_used: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string | null
          camera_position?: string | null
          created_at?: string
          forward_direction?: string | null
          id?: string
          input_upload_ids?: Json
          last_error?: string | null
          output_resolution?: string | null
          output_upload_id?: string | null
          owner_id: string
          progress_int?: number | null
          progress_message?: string | null
          project_id: string
          prompt_used?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string | null
          camera_position?: string | null
          created_at?: string
          forward_direction?: string | null
          id?: string
          input_upload_ids?: Json
          last_error?: string | null
          output_resolution?: string | null
          output_upload_id?: string | null
          owner_id?: string
          progress_int?: number | null
          progress_message?: string | null
          project_id?: string
          prompt_used?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "multi_image_panorama_jobs_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "multi_image_panorama_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          owner_id: string
          project_id: string | null
          target_params: Json | null
          target_route: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          owner_id: string
          project_id?: string | null
          target_params?: Json | null
          target_route?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          owner_id?: string
          project_id?: string | null
          target_params?: Json | null
          target_route?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      pipeline_suggestions: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_generated: boolean | null
          prompt: string
          step_number: number
          title: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_generated?: boolean | null
          prompt: string
          step_number: number
          title: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_generated?: boolean | null
          prompt?: string
          step_number?: number
          title?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["project_status"]
          style_profile: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["project_status"]
          style_profile?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["project_status"]
          style_profile?: Json | null
        }
        Relationships: []
      }
      render_job_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          id: string
          job_id: string
          nano_prompt_used: string | null
          output_upload_id: string | null
          owner_id: string
          qa_decision: string | null
          qa_reason: string | null
        }
        Insert: {
          attempt_number?: number
          created_at?: string
          id?: string
          job_id: string
          nano_prompt_used?: string | null
          output_upload_id?: string | null
          owner_id: string
          qa_decision?: string | null
          qa_reason?: string | null
        }
        Update: {
          attempt_number?: number
          created_at?: string
          id?: string
          job_id?: string
          nano_prompt_used?: string | null
          output_upload_id?: string | null
          owner_id?: string
          qa_decision?: string | null
          qa_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_job_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_job_attempts_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      render_job_events: {
        Row: {
          id: string
          job_id: string
          message: string
          owner_id: string
          progress_int: number
          ts: string
          type: string
        }
        Insert: {
          id?: string
          job_id: string
          message: string
          owner_id: string
          progress_int?: number
          ts?: string
          type: string
        }
        Update: {
          id?: string
          job_id?: string
          message?: string
          owner_id?: string
          progress_int?: number
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      render_job_logs: {
        Row: {
          created_at: string
          id: string
          job_id: string
          level: string
          message: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          level?: string
          message: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          level?: string
          message?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_job_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "render_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      render_jobs: {
        Row: {
          attempts: number
          base_prompt: string | null
          change_request: string
          created_at: string | null
          design_ref_upload_ids: Json | null
          id: string
          last_error: string | null
          max_attempts: number | null
          output_resolution: string | null
          output_upload_id: string | null
          owner_id: string
          panorama_deleted: boolean | null
          panorama_upload_id: string
          progress: number | null
          progress_int: number | null
          progress_message: string | null
          project_id: string
          qa_reason: string | null
          qa_status: string | null
          status: Database["public"]["Enums"]["job_status"]
          style_profile: Json | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          base_prompt?: string | null
          change_request: string
          created_at?: string | null
          design_ref_upload_ids?: Json | null
          id?: string
          last_error?: string | null
          max_attempts?: number | null
          output_resolution?: string | null
          output_upload_id?: string | null
          owner_id: string
          panorama_deleted?: boolean | null
          panorama_upload_id: string
          progress?: number | null
          progress_int?: number | null
          progress_message?: string | null
          project_id: string
          qa_reason?: string | null
          qa_status?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          style_profile?: Json | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          base_prompt?: string | null
          change_request?: string
          created_at?: string | null
          design_ref_upload_ids?: Json | null
          id?: string
          last_error?: string | null
          max_attempts?: number | null
          output_resolution?: string | null
          output_upload_id?: string | null
          owner_id?: string
          panorama_deleted?: boolean | null
          panorama_upload_id?: string
          progress?: number | null
          progress_int?: number | null
          progress_message?: string | null
          project_id?: string
          qa_reason?: string | null
          qa_status?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          style_profile?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_jobs_panorama_upload_id_fkey"
            columns: ["panorama_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          bucket: string
          created_at: string | null
          id: string
          kind: string
          mime_type: string | null
          original_filename: string | null
          owner_id: string
          path: string
          project_id: string
          size_bytes: number | null
        }
        Insert: {
          bucket: string
          created_at?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          original_filename?: string | null
          owner_id: string
          path: string
          project_id: string
          size_bytes?: number | null
        }
        Update: {
          bucket?: string
          created_at?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          original_filename?: string | null
          owner_id?: string
          path?: string
          project_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      virtual_tour_jobs: {
        Row: {
          created_at: string
          id: string
          input_asset_ids: string[]
          input_type: string
          last_error: string | null
          max_items: number
          owner_id: string
          preview_url: string | null
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_asset_ids?: string[]
          input_type?: string
          last_error?: string | null
          max_items?: number
          owner_id: string
          preview_url?: string | null
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          input_asset_ids?: string[]
          input_type?: string
          last_error?: string | null
          max_items?: number
          owner_id?: string
          preview_url?: string | null
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "virtual_tour_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_job_feed: {
        Args: { status_filter?: string }
        Returns: {
          deep_link_route: string
          job_id: string
          job_type: string
          last_error: string
          output_upload_id: string
          project_id: string
          project_name: string
          source_filename: string
          status: string
          step_number: number
          updated_at: string
        }[]
      }
      get_projects_with_job_counts: {
        Args: never
        Returns: {
          active_jobs_count: number
          completed_filenames: string[]
          completed_jobs_count: number
          created_at: string
          failed_filenames: string[]
          failed_jobs_count: number
          id: string
          last_job_updated_at: string
          name: string
          owner_id: string
          status: string
          style_profile: Json
        }[]
      }
    }
    Enums: {
      job_status:
        | "queued"
        | "running"
        | "needs_review"
        | "approved"
        | "rejected"
        | "failed"
      project_status: "draft" | "active" | "completed" | "failed"
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
      job_status: [
        "queued",
        "running",
        "needs_review",
        "approved",
        "rejected",
        "failed",
      ],
      project_status: ["draft", "active", "completed", "failed"],
    },
  },
} as const
