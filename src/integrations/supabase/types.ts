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
      floorplan_pipeline_spaces: {
        Row: {
          bounds_note: string | null
          confidence: number | null
          created_at: string
          excluded_at: string | null
          excluded_reason: string | null
          final_360_status: string | null
          id: string
          include_in_generation: boolean | null
          is_excluded: boolean | null
          name: string
          owner_id: string
          panorama_a_status: string | null
          panorama_b_status: string | null
          pipeline_id: string
          reference_image_ids: Json | null
          render_a_status: string | null
          render_b_status: string | null
          space_type: string
          status: string
          updated_at: string
        }
        Insert: {
          bounds_note?: string | null
          confidence?: number | null
          created_at?: string
          excluded_at?: string | null
          excluded_reason?: string | null
          final_360_status?: string | null
          id?: string
          include_in_generation?: boolean | null
          is_excluded?: boolean | null
          name: string
          owner_id: string
          panorama_a_status?: string | null
          panorama_b_status?: string | null
          pipeline_id: string
          reference_image_ids?: Json | null
          render_a_status?: string | null
          render_b_status?: string | null
          space_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          bounds_note?: string | null
          confidence?: number | null
          created_at?: string
          excluded_at?: string | null
          excluded_reason?: string | null
          final_360_status?: string | null
          id?: string
          include_in_generation?: boolean | null
          is_excluded?: boolean | null
          name?: string
          owner_id?: string
          panorama_a_status?: string | null
          panorama_b_status?: string | null
          pipeline_id?: string
          reference_image_ids?: Json | null
          render_a_status?: string | null
          render_b_status?: string | null
          space_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_pipeline_spaces_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_pipeline_step_attempts: {
        Row: {
          attempt_index: number
          created_at: string
          id: string
          model_used: string | null
          output_upload_id: string | null
          owner_id: string
          pipeline_id: string
          prompt_used: string | null
          qa_reason_full: string | null
          qa_reason_short: string | null
          qa_result_json: Json | null
          qa_status: string
          step_number: number
        }
        Insert: {
          attempt_index?: number
          created_at?: string
          id?: string
          model_used?: string | null
          output_upload_id?: string | null
          owner_id: string
          pipeline_id: string
          prompt_used?: string | null
          qa_reason_full?: string | null
          qa_reason_short?: string | null
          qa_result_json?: Json | null
          qa_status?: string
          step_number: number
        }
        Update: {
          attempt_index?: number
          created_at?: string
          id?: string
          model_used?: string | null
          output_upload_id?: string | null
          owner_id?: string
          pipeline_id?: string
          prompt_used?: string | null
          qa_reason_full?: string | null
          qa_reason_short?: string | null
          qa_result_json?: Json | null
          qa_status?: string
          step_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_pipeline_step_attempts_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_pipeline_step_attempts_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_pipelines: {
        Row: {
          architecture_version: string | null
          aspect_ratio: string | null
          auto_retry_enabled: boolean | null
          camera_plan_confirmed_at: string | null
          camera_position: string | null
          camera_scan_status: string | null
          camera_scan_updated_at: string | null
          created_at: string
          current_step: number
          current_step_last_heartbeat_at: string | null
          floor_plan_upload_id: string
          forward_direction: string | null
          global_3d_render_id: string | null
          global_phase: string | null
          global_style_bible: Json | null
          id: string
          is_enabled: boolean
          last_error: string | null
          last_state_integrity_fix_at: string | null
          last_state_integrity_fix_reason: string | null
          output_resolution: string | null
          owner_id: string
          panoramas_approved_at: string | null
          pause_reason: string | null
          paused_at: string | null
          pipeline_mode: string | null
          project_id: string
          quality_post_step4: string | null
          ratio_locked: boolean | null
          renders_approved_at: string | null
          resumed_at: string | null
          run_state: string | null
          spaces_approved_at: string | null
          status: string
          step_outputs: Json | null
          step_retry_state: Json | null
          step3_attempt_count: number | null
          step3_job_id: string | null
          step3_last_backend_event_at: string | null
          step4_job_id: string | null
          step5_job_id: string | null
          step6_job_id: string | null
          total_retry_count: number | null
          updated_at: string
          whole_apartment_phase: string | null
        }
        Insert: {
          architecture_version?: string | null
          aspect_ratio?: string | null
          auto_retry_enabled?: boolean | null
          camera_plan_confirmed_at?: string | null
          camera_position?: string | null
          camera_scan_status?: string | null
          camera_scan_updated_at?: string | null
          created_at?: string
          current_step?: number
          current_step_last_heartbeat_at?: string | null
          floor_plan_upload_id: string
          forward_direction?: string | null
          global_3d_render_id?: string | null
          global_phase?: string | null
          global_style_bible?: Json | null
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_state_integrity_fix_at?: string | null
          last_state_integrity_fix_reason?: string | null
          output_resolution?: string | null
          owner_id: string
          panoramas_approved_at?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          pipeline_mode?: string | null
          project_id: string
          quality_post_step4?: string | null
          ratio_locked?: boolean | null
          renders_approved_at?: string | null
          resumed_at?: string | null
          run_state?: string | null
          spaces_approved_at?: string | null
          status?: string
          step_outputs?: Json | null
          step_retry_state?: Json | null
          step3_attempt_count?: number | null
          step3_job_id?: string | null
          step3_last_backend_event_at?: string | null
          step4_job_id?: string | null
          step5_job_id?: string | null
          step6_job_id?: string | null
          total_retry_count?: number | null
          updated_at?: string
          whole_apartment_phase?: string | null
        }
        Update: {
          architecture_version?: string | null
          aspect_ratio?: string | null
          auto_retry_enabled?: boolean | null
          camera_plan_confirmed_at?: string | null
          camera_position?: string | null
          camera_scan_status?: string | null
          camera_scan_updated_at?: string | null
          created_at?: string
          current_step?: number
          current_step_last_heartbeat_at?: string | null
          floor_plan_upload_id?: string
          forward_direction?: string | null
          global_3d_render_id?: string | null
          global_phase?: string | null
          global_style_bible?: Json | null
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_state_integrity_fix_at?: string | null
          last_state_integrity_fix_reason?: string | null
          output_resolution?: string | null
          owner_id?: string
          panoramas_approved_at?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          pipeline_mode?: string | null
          project_id?: string
          quality_post_step4?: string | null
          ratio_locked?: boolean | null
          renders_approved_at?: string | null
          resumed_at?: string | null
          run_state?: string | null
          spaces_approved_at?: string | null
          status?: string
          step_outputs?: Json | null
          step_retry_state?: Json | null
          step3_attempt_count?: number | null
          step3_job_id?: string | null
          step3_last_backend_event_at?: string | null
          step4_job_id?: string | null
          step5_job_id?: string | null
          step6_job_id?: string | null
          total_retry_count?: number | null
          updated_at?: string
          whole_apartment_phase?: string | null
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
      floorplan_space_final360: {
        Row: {
          attempt_count: number | null
          attempt_index: number | null
          auto_retry_enabled: boolean | null
          correction_mode: string | null
          created_at: string
          id: string
          job_type: string | null
          locked_approved: boolean | null
          merge_instructions: string | null
          model: string | null
          output_upload_id: string | null
          owner_id: string
          panorama_a_id: string | null
          panorama_b_id: string | null
          pipeline_id: string
          pre_rejection_qa_status: string | null
          qa_report: Json | null
          qa_status: string | null
          source_image_upload_id: string | null
          space_id: string
          status: string
          structured_qa_result: Json | null
          updated_at: string
          user_correction_text: string | null
        }
        Insert: {
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          correction_mode?: string | null
          created_at?: string
          id?: string
          job_type?: string | null
          locked_approved?: boolean | null
          merge_instructions?: string | null
          model?: string | null
          output_upload_id?: string | null
          owner_id: string
          panorama_a_id?: string | null
          panorama_b_id?: string | null
          pipeline_id: string
          pre_rejection_qa_status?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          source_image_upload_id?: string | null
          space_id: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Update: {
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          correction_mode?: string | null
          created_at?: string
          id?: string
          job_type?: string | null
          locked_approved?: boolean | null
          merge_instructions?: string | null
          model?: string | null
          output_upload_id?: string | null
          owner_id?: string
          panorama_a_id?: string | null
          panorama_b_id?: string | null
          pipeline_id?: string
          pre_rejection_qa_status?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          source_image_upload_id?: string | null
          space_id?: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_space_final360_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_final360_panorama_a_id_fkey"
            columns: ["panorama_a_id"]
            isOneToOne: false
            referencedRelation: "floorplan_space_panoramas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_final360_panorama_b_id_fkey"
            columns: ["panorama_b_id"]
            isOneToOne: false
            referencedRelation: "floorplan_space_panoramas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_final360_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_final360_source_image_upload_id_fkey"
            columns: ["source_image_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_final360_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipeline_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_space_panoramas: {
        Row: {
          adjacency_context: Json | null
          attempt_count: number | null
          attempt_index: number | null
          auto_retry_enabled: boolean | null
          camera_label: string | null
          camera_marker_id: string | null
          correction_mode: string | null
          created_at: string
          final_composed_prompt: string | null
          id: string
          job_type: string | null
          kind: string
          locked_approved: boolean | null
          model: string | null
          output_upload_id: string | null
          owner_id: string
          pipeline_id: string
          pre_rejection_qa_status: string | null
          prompt_text: string | null
          qa_report: Json | null
          qa_status: string | null
          quality: string | null
          ratio: string | null
          source_image_upload_id: string | null
          source_render_id: string | null
          space_id: string
          status: string
          structured_qa_result: Json | null
          updated_at: string
          user_correction_text: string | null
        }
        Insert: {
          adjacency_context?: Json | null
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          camera_label?: string | null
          camera_marker_id?: string | null
          correction_mode?: string | null
          created_at?: string
          final_composed_prompt?: string | null
          id?: string
          job_type?: string | null
          kind: string
          locked_approved?: boolean | null
          model?: string | null
          output_upload_id?: string | null
          owner_id: string
          pipeline_id: string
          pre_rejection_qa_status?: string | null
          prompt_text?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          quality?: string | null
          ratio?: string | null
          source_image_upload_id?: string | null
          source_render_id?: string | null
          space_id: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Update: {
          adjacency_context?: Json | null
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          camera_label?: string | null
          camera_marker_id?: string | null
          correction_mode?: string | null
          created_at?: string
          final_composed_prompt?: string | null
          id?: string
          job_type?: string | null
          kind?: string
          locked_approved?: boolean | null
          model?: string | null
          output_upload_id?: string | null
          owner_id?: string
          pipeline_id?: string
          pre_rejection_qa_status?: string | null
          prompt_text?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          quality?: string | null
          ratio?: string | null
          source_image_upload_id?: string | null
          source_render_id?: string | null
          space_id?: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_space_panoramas_camera_marker_id_fkey"
            columns: ["camera_marker_id"]
            isOneToOne: false
            referencedRelation: "pipeline_camera_markers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_panoramas_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_panoramas_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_panoramas_source_image_upload_id_fkey"
            columns: ["source_image_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_panoramas_source_render_id_fkey"
            columns: ["source_render_id"]
            isOneToOne: false
            referencedRelation: "floorplan_space_renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_panoramas_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipeline_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      floorplan_space_renders: {
        Row: {
          adjacency_context: Json | null
          attempt_count: number | null
          attempt_index: number | null
          auto_retry_enabled: boolean | null
          camera_label: string | null
          camera_marker_id: string | null
          correction_mode: string | null
          created_at: string
          final_composed_prompt: string | null
          id: string
          job_type: string | null
          kind: string
          locked_approved: boolean | null
          model: string | null
          output_upload_id: string | null
          owner_id: string
          pipeline_id: string
          pre_rejection_qa_status: string | null
          prompt_text: string | null
          qa_report: Json | null
          qa_status: string | null
          quality: string | null
          ratio: string | null
          source_image_upload_id: string | null
          space_id: string
          status: string
          structured_qa_result: Json | null
          updated_at: string
          user_correction_text: string | null
        }
        Insert: {
          adjacency_context?: Json | null
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          camera_label?: string | null
          camera_marker_id?: string | null
          correction_mode?: string | null
          created_at?: string
          final_composed_prompt?: string | null
          id?: string
          job_type?: string | null
          kind: string
          locked_approved?: boolean | null
          model?: string | null
          output_upload_id?: string | null
          owner_id: string
          pipeline_id: string
          pre_rejection_qa_status?: string | null
          prompt_text?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          quality?: string | null
          ratio?: string | null
          source_image_upload_id?: string | null
          space_id: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Update: {
          adjacency_context?: Json | null
          attempt_count?: number | null
          attempt_index?: number | null
          auto_retry_enabled?: boolean | null
          camera_label?: string | null
          camera_marker_id?: string | null
          correction_mode?: string | null
          created_at?: string
          final_composed_prompt?: string | null
          id?: string
          job_type?: string | null
          kind?: string
          locked_approved?: boolean | null
          model?: string | null
          output_upload_id?: string | null
          owner_id?: string
          pipeline_id?: string
          pre_rejection_qa_status?: string | null
          prompt_text?: string | null
          qa_report?: Json | null
          qa_status?: string | null
          quality?: string | null
          ratio?: string | null
          source_image_upload_id?: string | null
          space_id?: string
          status?: string
          structured_qa_result?: Json | null
          updated_at?: string
          user_correction_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floorplan_space_renders_camera_marker_id_fkey"
            columns: ["camera_marker_id"]
            isOneToOne: false
            referencedRelation: "pipeline_camera_markers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_renders_output_upload_id_fkey"
            columns: ["output_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_renders_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_renders_source_image_upload_id_fkey"
            columns: ["source_image_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floorplan_space_renders_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipeline_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      global_qa_results: {
        Row: {
          consistency_decision: string | null
          created_at: string
          id: string
          inconsistency_details: string | null
          inconsistency_type: string | null
          owner_id: string
          pipeline_id: string
          rerender_triggered: boolean | null
          room_pair: string[]
        }
        Insert: {
          consistency_decision?: string | null
          created_at?: string
          id?: string
          inconsistency_details?: string | null
          inconsistency_type?: string | null
          owner_id: string
          pipeline_id: string
          rerender_triggered?: boolean | null
          room_pair: string[]
        }
        Update: {
          consistency_decision?: string | null
          created_at?: string
          id?: string
          inconsistency_details?: string | null
          inconsistency_type?: string | null
          owner_id?: string
          pipeline_id?: string
          rerender_triggered?: boolean | null
          room_pair?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "global_qa_results_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
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
          reference_upload_ids: string[] | null
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
          reference_upload_ids?: string[] | null
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
          reference_upload_ids?: string[] | null
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
      pipeline_artifacts: {
        Row: {
          created_at: string
          id: string
          kind: string
          metadata_json: Json | null
          owner_id: string
          run_id: string
          signed_url_cached: string | null
          signed_url_expires_at: string | null
          step_id: string
          storage_bucket: string | null
          storage_path: string | null
          upload_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          metadata_json?: Json | null
          owner_id: string
          run_id: string
          signed_url_cached?: string | null
          signed_url_expires_at?: string | null
          step_id: string
          storage_bucket?: string | null
          storage_path?: string | null
          upload_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          metadata_json?: Json | null
          owner_id?: string
          run_id?: string
          signed_url_cached?: string | null
          signed_url_expires_at?: string | null
          step_id?: string
          storage_bucket?: string | null
          storage_path?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_artifacts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_camera_markers: {
        Row: {
          anchor_base_plan_path: string | null
          anchor_created_at: string | null
          anchor_crop_overlay_path: string | null
          anchor_error_message: string | null
          anchor_single_overlay_path: string | null
          anchor_status: string
          anchor_transform_hash: string | null
          created_at: string
          fov_deg: number
          id: string
          label: string
          marker_type: string
          mirror_enabled: boolean
          owner_id: string
          pipeline_id: string
          room_id: string | null
          sort_order: number
          updated_at: string
          x_norm: number
          y_norm: number
          yaw_deg: number
        }
        Insert: {
          anchor_base_plan_path?: string | null
          anchor_created_at?: string | null
          anchor_crop_overlay_path?: string | null
          anchor_error_message?: string | null
          anchor_single_overlay_path?: string | null
          anchor_status?: string
          anchor_transform_hash?: string | null
          created_at?: string
          fov_deg?: number
          id?: string
          label: string
          marker_type?: string
          mirror_enabled?: boolean
          owner_id: string
          pipeline_id: string
          room_id?: string | null
          sort_order?: number
          updated_at?: string
          x_norm: number
          y_norm: number
          yaw_deg?: number
        }
        Update: {
          anchor_base_plan_path?: string | null
          anchor_created_at?: string | null
          anchor_crop_overlay_path?: string | null
          anchor_error_message?: string | null
          anchor_single_overlay_path?: string | null
          anchor_status?: string
          anchor_transform_hash?: string | null
          created_at?: string
          fov_deg?: number
          id?: string
          label?: string
          marker_type?: string
          mirror_enabled?: boolean
          owner_id?: string
          pipeline_id?: string
          room_id?: string | null
          sort_order?: number
          updated_at?: string
          x_norm?: number
          y_norm?: number
          yaw_deg?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_camera_markers_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_camera_markers_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipeline_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_camera_scan_items: {
        Row: {
          created_at: string
          crop_expires_at: string | null
          crop_height: number | null
          crop_public_url: string | null
          crop_storage_path: string | null
          crop_width: number | null
          detected_label_bbox_norm: Json | null
          detected_label_confidence: number | null
          detected_room_label: string | null
          id: string
          is_temporary: boolean | null
          marker_id: string
          owner_id: string
          prompt_hint_text: string | null
          scan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          crop_expires_at?: string | null
          crop_height?: number | null
          crop_public_url?: string | null
          crop_storage_path?: string | null
          crop_width?: number | null
          detected_label_bbox_norm?: Json | null
          detected_label_confidence?: number | null
          detected_room_label?: string | null
          id?: string
          is_temporary?: boolean | null
          marker_id: string
          owner_id: string
          prompt_hint_text?: string | null
          scan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          crop_expires_at?: string | null
          crop_height?: number | null
          crop_public_url?: string | null
          crop_storage_path?: string | null
          crop_width?: number | null
          detected_label_bbox_norm?: Json | null
          detected_label_confidence?: number | null
          detected_room_label?: string | null
          id?: string
          is_temporary?: boolean | null
          marker_id?: string
          owner_id?: string
          prompt_hint_text?: string | null
          scan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_camera_scan_items_marker_id_fkey"
            columns: ["marker_id"]
            isOneToOne: false
            referencedRelation: "pipeline_camera_markers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_camera_scan_items_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "pipeline_camera_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_camera_scans: {
        Row: {
          created_at: string
          id: string
          model_used: string | null
          owner_id: string
          pipeline_id: string
          results_json: Json | null
          status: string
          updated_at: string
          version_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_used?: string | null
          owner_id: string
          pipeline_id: string
          results_json?: Json | null
          status?: string
          updated_at?: string
          version_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          model_used?: string | null
          owner_id?: string
          pipeline_id?: string
          results_json?: Json | null
          status?: string
          updated_at?: string
          version_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_camera_scans_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_decisions: {
        Row: {
          block_reason: string | null
          created_at: string
          decision: string
          id: string
          job_id: string | null
          llm_audit: Json | null
          owner_id: string
          processing_time_ms: number | null
          retry_budget_remaining: number
          rule_checks: Json
          run_id: string
          schema_validations: Json
          step_id: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          decision: string
          id?: string
          job_id?: string | null
          llm_audit?: Json | null
          owner_id: string
          processing_time_ms?: number | null
          retry_budget_remaining?: number
          rule_checks?: Json
          run_id: string
          schema_validations?: Json
          step_id: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          decision?: string
          id?: string
          job_id?: string | null
          llm_audit?: Json | null
          owner_id?: string
          processing_time_ms?: number | null
          retry_budget_remaining?: number
          rule_checks?: Json
          run_id?: string
          schema_validations?: Json
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_decisions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "pipeline_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          last_error_stack: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          owner_id: string
          payload_ref: Json | null
          processing_time_ms: number | null
          result_ref: Json | null
          run_id: string
          service: string
          started_at: string | null
          status: string
          step_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_error_stack?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          owner_id: string
          payload_ref?: Json | null
          processing_time_ms?: number | null
          result_ref?: Json | null
          run_id: string
          service: string
          started_at?: string | null
          status?: string
          step_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          last_error_stack?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          owner_id?: string
          payload_ref?: Json | null
          processing_time_ms?: number | null
          result_ref?: Json | null
          run_id?: string
          service?: string
          started_at?: string | null
          status?: string
          step_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          auto_retry_enabled: boolean | null
          completed_at: string | null
          created_at: string
          current_step: number
          id: string
          last_error: string | null
          last_error_stack: string | null
          owner_id: string
          payload_size_estimate: number | null
          pipeline_id: string
          quality_post_step4: string | null
          ratio: string | null
          ratio_locked: boolean | null
          started_at: string
          status: string
          step_qa_results: Json | null
          step_retries: number
          supervisor_decisions: Json | null
          total_retries: number
          updated_at: string
        }
        Insert: {
          auto_retry_enabled?: boolean | null
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_error?: string | null
          last_error_stack?: string | null
          owner_id: string
          payload_size_estimate?: number | null
          pipeline_id: string
          quality_post_step4?: string | null
          ratio?: string | null
          ratio_locked?: boolean | null
          started_at?: string
          status?: string
          step_qa_results?: Json | null
          step_retries?: number
          supervisor_decisions?: Json | null
          total_retries?: number
          updated_at?: string
        }
        Update: {
          auto_retry_enabled?: boolean | null
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_error?: string | null
          last_error_stack?: string | null
          owner_id?: string
          payload_size_estimate?: number | null
          pipeline_id?: string
          quality_post_step4?: string | null
          ratio?: string | null
          ratio_locked?: boolean | null
          started_at?: string
          status?: string
          step_qa_results?: Json | null
          step_retries?: number
          supervisor_decisions?: Json | null
          total_retries?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_spatial_maps: {
        Row: {
          adjacency_graph: Json | null
          created_at: string
          id: string
          locks_json: Json | null
          owner_id: string
          pipeline_id: string
          raw_analysis: string | null
          rooms: Json
          updated_at: string
          version: number
        }
        Insert: {
          adjacency_graph?: Json | null
          created_at?: string
          id?: string
          locks_json?: Json | null
          owner_id: string
          pipeline_id: string
          raw_analysis?: string | null
          rooms?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          adjacency_graph?: Json | null
          created_at?: string
          id?: string
          locks_json?: Json | null
          owner_id?: string
          pipeline_id?: string
          raw_analysis?: string | null
          rooms?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_spatial_maps_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
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
      qa_attempt_feedback: {
        Row: {
          attempt_number: number
          context_snapshot: Json | null
          created_at: string
          id: string
          image_id: string | null
          owner_id: string
          pipeline_id: string
          project_id: string
          qa_decision: string
          qa_reasons: Json | null
          step_id: number
          user_category: string
          user_comment_short: string | null
          user_vote: string
        }
        Insert: {
          attempt_number: number
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          image_id?: string | null
          owner_id: string
          pipeline_id: string
          project_id: string
          qa_decision: string
          qa_reasons?: Json | null
          step_id: number
          user_category: string
          user_comment_short?: string | null
          user_vote: string
        }
        Update: {
          attempt_number?: number
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          image_id?: string | null
          owner_id?: string
          pipeline_id?: string
          project_id?: string
          qa_decision?: string
          qa_reasons?: Json | null
          step_id?: number
          user_category?: string
          user_comment_short?: string | null
          user_vote?: string
        }
        Relationships: []
      }
      qa_calibration_stats: {
        Row: {
          category: string
          confirmed_correct_count: number
          false_approve_count: number
          false_reject_count: number
          id: string
          last_updated_at: string | null
          owner_id: string
          project_id: string | null
          step_id: number
        }
        Insert: {
          category: string
          confirmed_correct_count?: number
          false_approve_count?: number
          false_reject_count?: number
          id?: string
          last_updated_at?: string | null
          owner_id: string
          project_id?: string | null
          step_id: number
        }
        Update: {
          category?: string
          confirmed_correct_count?: number
          false_approve_count?: number
          false_reject_count?: number
          id?: string
          last_updated_at?: string | null
          owner_id?: string
          project_id?: string | null
          step_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "qa_calibration_stats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_case_index: {
        Row: {
          category: string
          created_at: string
          feedback_id: string
          id: string
          outcome_type: string
          owner_id: string
          searchable_text: string
          step_id: number
        }
        Insert: {
          category: string
          created_at?: string
          feedback_id: string
          id?: string
          outcome_type: string
          owner_id: string
          searchable_text: string
          step_id: number
        }
        Update: {
          category?: string
          created_at?: string
          feedback_id?: string
          id?: string
          outcome_type?: string
          owner_id?: string
          searchable_text?: string
          step_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "qa_case_index_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "qa_human_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_human_feedback: {
        Row: {
          attempt_number: number
          context_snapshot: Json | null
          created_at: string
          id: string
          image_id: string | null
          owner_id: string
          pipeline_id: string
          project_id: string
          qa_original_reasons: Json | null
          qa_original_status: string | null
          qa_was_wrong: boolean | null
          step_id: number
          user_category: string
          user_decision: string
          user_reason_short: string
        }
        Insert: {
          attempt_number?: number
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          image_id?: string | null
          owner_id: string
          pipeline_id: string
          project_id: string
          qa_original_reasons?: Json | null
          qa_original_status?: string | null
          qa_was_wrong?: boolean | null
          step_id: number
          user_category: string
          user_decision: string
          user_reason_short: string
        }
        Update: {
          attempt_number?: number
          context_snapshot?: Json | null
          created_at?: string
          id?: string
          image_id?: string | null
          owner_id?: string
          pipeline_id?: string
          project_id?: string
          qa_original_reasons?: Json | null
          qa_original_status?: string | null
          qa_was_wrong?: boolean | null
          step_id?: number
          user_category?: string
          user_decision?: string
          user_reason_short?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_human_feedback_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_human_feedback_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_human_feedback_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_judge_results: {
        Row: {
          ab_bucket: string | null
          attempt_index: number
          confidence: number | null
          created_at: string
          full_result: Json
          id: string
          judge_model: string
          output_id: string | null
          owner_id: string
          pass: boolean
          pipeline_id: string
          processing_time_ms: number | null
          project_id: string
          prompt_name: string | null
          prompt_version: string | null
          reasons: string[]
          score: number | null
          step_number: number
          sub_step: string | null
          violated_rules: string[]
        }
        Insert: {
          ab_bucket?: string | null
          attempt_index?: number
          confidence?: number | null
          created_at?: string
          full_result?: Json
          id?: string
          judge_model: string
          output_id?: string | null
          owner_id: string
          pass: boolean
          pipeline_id: string
          processing_time_ms?: number | null
          project_id: string
          prompt_name?: string | null
          prompt_version?: string | null
          reasons?: string[]
          score?: number | null
          step_number: number
          sub_step?: string | null
          violated_rules?: string[]
        }
        Update: {
          ab_bucket?: string | null
          attempt_index?: number
          confidence?: number | null
          created_at?: string
          full_result?: Json
          id?: string
          judge_model?: string
          output_id?: string | null
          owner_id?: string
          pass?: boolean
          pipeline_id?: string
          processing_time_ms?: number | null
          project_id?: string
          prompt_name?: string | null
          prompt_version?: string | null
          reasons?: string[]
          score?: number | null
          step_number?: number
          sub_step?: string | null
          violated_rules?: string[]
        }
        Relationships: []
      }
      qa_policy_rules: {
        Row: {
          category: string
          created_at: string
          created_from_feedback_id: string | null
          id: string
          last_supported_at: string | null
          owner_id: string
          project_id: string | null
          rule_status: string
          rule_text: string
          scope_level: string
          step_id: number | null
          support_count: number
        }
        Insert: {
          category: string
          created_at?: string
          created_from_feedback_id?: string | null
          id?: string
          last_supported_at?: string | null
          owner_id: string
          project_id?: string | null
          rule_status?: string
          rule_text: string
          scope_level: string
          step_id?: number | null
          support_count?: number
        }
        Update: {
          category?: string
          created_at?: string
          created_from_feedback_id?: string | null
          id?: string
          last_supported_at?: string | null
          owner_id?: string
          project_id?: string | null
          rule_status?: string
          rule_text?: string
          scope_level?: string
          step_id?: number | null
          support_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "qa_policy_rules_created_from_feedback_id_fkey"
            columns: ["created_from_feedback_id"]
            isOneToOne: false
            referencedRelation: "qa_human_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_policy_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      room_sub_pipeline_events: {
        Row: {
          id: string
          message: string
          owner_id: string
          progress_int: number | null
          room_sub_pipeline_id: string
          step_type: string
          ts: string
          type: string
        }
        Insert: {
          id?: string
          message: string
          owner_id: string
          progress_int?: number | null
          room_sub_pipeline_id: string
          step_type: string
          ts?: string
          type: string
        }
        Update: {
          id?: string
          message?: string
          owner_id?: string
          progress_int?: number | null
          room_sub_pipeline_id?: string
          step_type?: string
          ts?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_sub_pipeline_events_room_sub_pipeline_id_fkey"
            columns: ["room_sub_pipeline_id"]
            isOneToOne: false
            referencedRelation: "room_sub_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      room_sub_pipelines: {
        Row: {
          bounds: Json | null
          camera_renders: Json | null
          created_at: string
          id: string
          owner_id: string
          panorama_qa_decision: string | null
          panorama_qa_reason: string | null
          panorama_upload_id: string | null
          pipeline_id: string
          room_id: string
          room_label: string | null
          room_type: string
          status: string
          updated_at: string
        }
        Insert: {
          bounds?: Json | null
          camera_renders?: Json | null
          created_at?: string
          id?: string
          owner_id: string
          panorama_qa_decision?: string | null
          panorama_qa_reason?: string | null
          panorama_upload_id?: string | null
          pipeline_id: string
          room_id: string
          room_label?: string | null
          room_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          bounds?: Json | null
          camera_renders?: Json | null
          created_at?: string
          id?: string
          owner_id?: string
          panorama_qa_decision?: string | null
          panorama_qa_reason?: string | null
          panorama_upload_id?: string | null
          pipeline_id?: string
          room_id?: string
          room_label?: string | null
          room_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_sub_pipelines_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "floorplan_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      system_prompt_templates: {
        Row: {
          ai_generation_prompt: string | null
          created_at: string | null
          description: string | null
          generated_by_ai: boolean | null
          id: string
          is_active: boolean | null
          placeholders: Json
          template_content: string
          template_type: string
          template_version: number
          updated_at: string | null
        }
        Insert: {
          ai_generation_prompt?: string | null
          created_at?: string | null
          description?: string | null
          generated_by_ai?: boolean | null
          id?: string
          is_active?: boolean | null
          placeholders?: Json
          template_content: string
          template_type: string
          template_version?: number
          updated_at?: string | null
        }
        Update: {
          ai_generation_prompt?: string | null
          created_at?: string | null
          description?: string | null
          generated_by_ai?: boolean | null
          id?: string
          is_active?: boolean | null
          placeholders?: Json
          template_content?: string
          template_type?: string
          template_version?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      uploads: {
        Row: {
          bucket: string
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          file_hash: string | null
          id: string
          is_preview: boolean | null
          kind: string
          mime_type: string | null
          original_filename: string | null
          original_height: number | null
          original_width: number | null
          owner_id: string
          path: string
          preview_upload_id: string | null
          processing_status: string | null
          project_id: string
          size_bytes: number | null
        }
        Insert: {
          bucket: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          file_hash?: string | null
          id?: string
          is_preview?: boolean | null
          kind: string
          mime_type?: string | null
          original_filename?: string | null
          original_height?: number | null
          original_width?: number | null
          owner_id: string
          path: string
          preview_upload_id?: string | null
          processing_status?: string | null
          project_id: string
          size_bytes?: number | null
        }
        Update: {
          bucket?: string
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          file_hash?: string | null
          id?: string
          is_preview?: boolean | null
          kind?: string
          mime_type?: string | null
          original_filename?: string | null
          original_height?: number | null
          original_width?: number | null
          owner_id?: string
          path?: string
          preview_upload_id?: string | null
          processing_status?: string | null
          project_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "uploads_preview_upload_id_fkey"
            columns: ["preview_upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
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
      worker_outputs: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          input_schema_hash: string | null
          llm_model_used: string | null
          output_data: Json
          processing_time_ms: number | null
          run_id: string
          schema_valid: boolean | null
          step_id: string
          supervisor_approved: boolean | null
          worker_type: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_schema_hash?: string | null
          llm_model_used?: string | null
          output_data?: Json
          processing_time_ms?: number | null
          run_id: string
          schema_valid?: boolean | null
          step_id: string
          supervisor_approved?: boolean | null
          worker_type: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          input_schema_hash?: string | null
          llm_model_used?: string | null
          output_data?: Json
          processing_time_ms?: number | null
          run_id?: string
          schema_valid?: boolean | null
          step_id?: string
          supervisor_approved?: boolean | null
          worker_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_outputs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_job_lock: {
        Args: {
          p_lock_duration_seconds?: number
          p_lock_owner: string
          p_run_id: string
          p_service: string
          p_step_id: string
        }
        Returns: string
      }
      compute_camera_transform_hash: {
        Args: {
          p_fov_deg: number
          p_room_id: string
          p_x_norm: number
          p_y_norm: number
          p_yaw_deg: number
        }
        Returns: string
      }
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
      is_job_running: {
        Args: { p_run_id: string; p_service: string; p_step_id: string }
        Returns: boolean
      }
      manual_approve_floorplan_pipeline_step: {
        Args: {
          p_notes?: Json
          p_output_upload_id?: string
          p_owner_id: string
          p_pipeline_id: string
          p_step_number: number
        }
        Returns: {
          architecture_version: string | null
          aspect_ratio: string | null
          auto_retry_enabled: boolean | null
          camera_plan_confirmed_at: string | null
          camera_position: string | null
          camera_scan_status: string | null
          camera_scan_updated_at: string | null
          created_at: string
          current_step: number
          current_step_last_heartbeat_at: string | null
          floor_plan_upload_id: string
          forward_direction: string | null
          global_3d_render_id: string | null
          global_phase: string | null
          global_style_bible: Json | null
          id: string
          is_enabled: boolean
          last_error: string | null
          last_state_integrity_fix_at: string | null
          last_state_integrity_fix_reason: string | null
          output_resolution: string | null
          owner_id: string
          panoramas_approved_at: string | null
          pause_reason: string | null
          paused_at: string | null
          pipeline_mode: string | null
          project_id: string
          quality_post_step4: string | null
          ratio_locked: boolean | null
          renders_approved_at: string | null
          resumed_at: string | null
          run_state: string | null
          spaces_approved_at: string | null
          status: string
          step_outputs: Json | null
          step_retry_state: Json | null
          step3_attempt_count: number | null
          step3_job_id: string | null
          step3_last_backend_event_at: string | null
          step4_job_id: string | null
          step5_job_id: string | null
          step6_job_id: string | null
          total_retry_count: number | null
          updated_at: string
          whole_apartment_phase: string | null
        }
        SetofOptions: {
          from: "*"
          to: "floorplan_pipelines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recover_pipeline_state: {
        Args: { p_owner_id: string; p_pipeline_id: string }
        Returns: {
          architecture_version: string | null
          aspect_ratio: string | null
          auto_retry_enabled: boolean | null
          camera_plan_confirmed_at: string | null
          camera_position: string | null
          camera_scan_status: string | null
          camera_scan_updated_at: string | null
          created_at: string
          current_step: number
          current_step_last_heartbeat_at: string | null
          floor_plan_upload_id: string
          forward_direction: string | null
          global_3d_render_id: string | null
          global_phase: string | null
          global_style_bible: Json | null
          id: string
          is_enabled: boolean
          last_error: string | null
          last_state_integrity_fix_at: string | null
          last_state_integrity_fix_reason: string | null
          output_resolution: string | null
          owner_id: string
          panoramas_approved_at: string | null
          pause_reason: string | null
          paused_at: string | null
          pipeline_mode: string | null
          project_id: string
          quality_post_step4: string | null
          ratio_locked: boolean | null
          renders_approved_at: string | null
          resumed_at: string | null
          run_state: string | null
          spaces_approved_at: string | null
          status: string
          step_outputs: Json | null
          step_retry_state: Json | null
          step3_attempt_count: number | null
          step3_job_id: string | null
          step3_last_backend_event_at: string | null
          step4_job_id: string | null
          step5_job_id: string | null
          step6_job_id: string | null
          total_retry_count: number | null
          updated_at: string
          whole_apartment_phase: string | null
        }
        SetofOptions: {
          from: "*"
          to: "floorplan_pipelines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_job_lock: {
        Args: {
          p_error?: string
          p_error_stack?: string
          p_job_id: string
          p_processing_time_ms?: number
          p_result_ref?: Json
          p_status: string
        }
        Returns: boolean
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
