# 🛰️ Project Constitution (gemini.md)

**Status:** 🟢 Living Blueprint (Approved with Reality Validation Gate)
**Created:** 2026-02-08
**Last Updated:** 2026-02-08 16:30 UTC
**Next Milestone:** Secret Verification → Real Pipeline Test → Phase 3 Checkpoint

---

## ⚠️ Blueprint Philosophy

This document is a **living blueprint**, not a frozen constitution.

- **Proposed Patterns**: Retry limits (3 attempts), backoff (1s/2s/4s), DLQ, framework inspirations (DeepEval, XState) are **approved defaults**, not hard laws.
- **Reality Validation**: Architectural decisions must be validated against **real pipeline failures** and **actual Supabase Edge Function constraints**.
- **Evolution**: Schemas, rules, and patterns will evolve after observing real end-to-end execution (Step 0 → final output).
- **Checkpoint**: Phase 3 (Architect) requires approval **after** Phase 2 (Link) and **at least one full real pipeline run**.

---

## 📐 Data Schemas

### Core Pipeline Schema

#### Input Schema (Floor Plan Upload)
```typescript
FloorPlanInput {
  // User upload
  file: File (PNG/JPG, max 10MB)
  original_filename: string
  project_id: UUID
  owner_id: UUID (from auth.uid())

  // Optional design preferences
  design_ref_upload_ids?: UUID[] (reference images)
  style_profile?: {
    style_name: string
    tone: string (modern, classical, minimalist, etc.)
    materials: string[]
    color_palette: string[]
  }

  // Pipeline configuration
  output_resolution: "2K" | "4K" (default: "2K")
  aspect_ratio: "16:9" | "4:3" | "1:1" (default: "16:9")
}
```

#### Pipeline State Schema (Source of Truth)
```typescript
FloorplanPipeline {
  // Identity
  id: UUID
  project_id: UUID
  owner_id: UUID
  floor_plan_upload_id: UUID (FK to uploads)

  // State Machine
  current_step: 0-7 (integer)
  whole_apartment_phase: string (30+ possible values)
  status: string (mapped to phase)
  architecture_version: "v1_linear" | "v2_branching"

  // Step Outputs (JSONB keyed by "step_0", "step_1", etc.)
  step_outputs: {
    step_0?: { spatial_map_id: UUID, rooms: Room[], graph: AdjacencyGraph }
    step_1?: { output_upload_id: UUID, approved: boolean, attempt: number }
    step_2?: { output_upload_id: UUID, approved: boolean, style_bible: JSONB }
    step_3?: { camera_markers: CameraMarker[], confirmed_at: ISO8601 }
    step_4?: { detected_spaces: Space[], space_ids: UUID[] }
    step_5?: { render_ids: UUID[], completed: number, total: number }
    step_6?: { panorama_ids: UUID[], completed: number, total: number }
    step_7?: { final_360_ids: UUID[], all_approved: boolean }
  }

  // Retry/Recovery State (JSONB keyed by "step_0", etc.)
  step_retry_state: {
    [step_key: string]: {
      attempt_count: number
      max_attempts: number (default: 3)
      last_error?: string
      last_attempt_at?: ISO8601
      retry_allowed: boolean
    }
  }

  // Global Context
  global_phase?: string (cross-step context)
  global_3d_render_id?: UUID (Step 1 output)
  global_style_bible?: JSONB (Step 2 output)

  // Error Recovery
  last_error?: string
  last_state_integrity_fix_at?: ISO8601
  last_state_integrity_fix_reason?: string

  // Timestamps
  created_at: ISO8601
  updated_at: ISO8601 (auto-updated)
}
```

#### Space Analysis Schema (Step 0 Output)
```typescript
SpatialMap {
  id: UUID
  pipeline_id: UUID
  owner_id: UUID

  // Room definitions
  rooms: Array<{
    room_id: string
    room_type: string (living_room, bedroom, kitchen, etc.)
    bounds: { x: number, y: number, width: number, height: number }
    area_sqm?: number
    features: string[] (windows, doors, openings)
  }>

  // Connectivity graph
  adjacency_graph: {
    nodes: string[] (room IDs)
    edges: Array<{
      from: string
      to: string
      connection_type: "door" | "opening" | "hallway"
    }>
  }

  // Raw LLM analysis
  raw_analysis: string (full text from Gemini)

  created_at: ISO8601
}
```

#### Camera Marker Schema (Step 3 Output)
```typescript
CameraMarker {
  id: UUID
  pipeline_id: UUID
  owner_id: UUID

  // Position (normalized 0-1 coordinates on floor plan image)
  x_norm: number (0.0-1.0)
  y_norm: number (0.0-1.0)

  // Orientation
  yaw_deg: number (0-359, 0=North, 90=East, 180=South, 270=West)
  fov_deg: number (10-180, default: 80)

  // Binding
  label?: string (user-defined camera name)
  room_id?: UUID (FK to floorplan_pipeline_spaces)

  // Ordering
  sort_order: number (default: 0)

  created_at: ISO8601
  updated_at: ISO8601
}
```

#### Render/Panorama Schema (Steps 5-6 Output)
```typescript
SpaceRender {
  id: UUID
  space_id: UUID (FK to floorplan_pipeline_spaces)
  pipeline_id: UUID
  owner_id: UUID

  // Variant
  kind: "A" | "B" (A/B testing)

  // Status
  status: "pending" | "running" | "completed" | "failed"
  attempt_index: number (default: 1)

  // Output
  output_upload_id?: UUID (FK to uploads)

  // Generation Details
  prompt_text: string (user-facing prompt)
  final_composed_prompt: string (full prompt with system instructions)
  model: string (nano_banana_v1, etc.)
  ratio: "16:9" | "4:3" | "1:1"
  quality: "2K" | "4K"

  // Context
  adjacency_context?: JSONB (neighboring rooms for consistency)
  camera_marker_id?: UUID (which camera this render is from)
  camera_label?: string

  // QA Evaluation
  qa_status: "pending" | "approved" | "rejected"
  qa_report?: {
    pass: boolean
    score: number (0-100)
    confidence: number (0-1)
    reasons: string[]
    violated_rules: string[]
  }
  locked_approved: boolean (default: false)

  created_at: ISO8601
  updated_at: ISO8601
}

// SpacePanorama follows identical structure with ratio: "2:1"
// Final360 represents merged panorama (A+B → single 360)
```

#### QA Judge Result Schema (LLM-as-Judge Output)
```typescript
QAJudgeResult {
  id: UUID
  pipeline_id: UUID
  project_id: UUID
  owner_id: UUID

  // Context
  step_number: 0-7
  sub_step?: string (e.g., "3.1", "3.2")
  output_id: UUID (FK to render/panorama/upload)
  attempt_index: number (default: 1)

  // Evaluation Result
  pass: boolean (true = approved, false = rejected)
  score: number (0.00-100.00)
  confidence: number (0.0000-1.0000)
  reasons: string[] (human-readable explanations)
  violated_rules: string[] (specific rule violations)
  full_result: JSONB (complete LLM response)

  // Model/Prompt Tracking
  judge_model: string (gpt-4-vision, claude-opus-4, etc.)
  prompt_name?: string (QA prompt version)
  prompt_version?: string
  ab_bucket?: "A" | "B" (A/B testing prompt variants)

  // Performance
  processing_time_ms: number

  created_at: ISO8601
}
```

---

### Output Delivery Schema

#### Dashboard UI Output
```typescript
PipelineUIState {
  // Current State
  pipeline_id: UUID
  current_step: number
  phase: string
  progress_percent: number (0-100)

  // Step Status (for stepper UI)
  steps: Array<{
    step_number: 0-7
    label: string
    status: "pending" | "in_progress" | "review" | "approved" | "failed"
    cta_type: "RUN" | "CONTINUE" | "APPROVE" | "EDITOR" | "DISABLED" | "NONE"
    cta_label: string
  }>

  // Outputs per Step
  outputs: {
    step_0?: { spatial_map: SpatialMap }
    step_1?: { image_url: string, approved: boolean }
    step_2?: { image_url: string, style_bible: JSONB, approved: boolean }
    step_3?: { camera_count: number, confirmed: boolean }
    step_4?: { space_count: number }
    step_5?: { renders: Array<{ id: UUID, space: string, kind: "A"|"B", url: string, qa: QAStatus }> }
    step_6?: { panoramas: Array<{ id: UUID, space: string, kind: "A"|"B", url: string, qa: QAStatus }> }
    step_7?: { final_360s: Array<{ id: UUID, space: string, url: string, approved: boolean }> }
  }

  // Logs Terminal
  events: Array<{
    timestamp: ISO8601
    type: string
    message: string
    progress_int?: number
  }>

  // Error State
  error?: {
    message: string
    step: number
    retry_count: number
    can_retry: boolean
  }
}
```

#### Storage Output Structure
```
Supabase Storage Buckets (Private, User-Scoped):

outputs/
  {user_id}/
    {pipeline_id}/
      step_0/
        spatial_map.json
      step_1/
        attempt_1_top_down_3d.png
        attempt_2_top_down_3d.png (if retried)
      step_2/
        attempt_1_styled.png
        style_bible.json
      step_5/
        {space_id}/
          render_A_attempt_1.png
          render_B_attempt_1.png
      step_6/
        {space_id}/
          panorama_A_attempt_1.png (2:1 ratio)
          panorama_B_attempt_1.png
      step_7/
        {space_id}/
          final_360_merged.png (approved deliverable)

design_refs/
  {user_id}/
    {upload_id}.png (reference images)

panoramas/
  {user_id}/
    {upload_id}.png (floor plan uploads)
```

#### Notification Payload
```typescript
PipelineNotification {
  type: "completion" | "failure" | "review_required"
  pipeline_id: UUID
  project_id: UUID
  step_number: number

  // Completion
  message?: string ("Step 5 completed: 12 renders generated")

  // Failure
  error?: {
    step: number
    message: string
    retry_count: number
    next_retry_at?: ISO8601
  }

  // Review Required
  review?: {
    step: number
    output_count: number
    outputs: Array<{ id: UUID, preview_url: string }>
  }

  timestamp: ISO8601
}
```

---

## 🎯 Behavioral Rules

### Core Principles

#### User-Facing Tone
- **Professional**: Technical precision without jargon overload
- **Concise**: Short status messages, detailed logs available on demand
- **Architectural**: Use domain terminology (renders, panoramas, spatial analysis, camera planning)
- **Transparent**: Show progress, errors, and QA decisions with reasons

#### Logic Constraints

1. **Strict Step Order**
   - Step 0 (Space Analysis) must complete before any image generation
   - Steps 1-2 must be approved before Step 3 (Camera Planning)
   - No skipping steps or reordering phases

2. **Manual QA Gates**
   - Any step that generates images (1, 2, 5, 6, 7) requires manual approval before continuing
   - No auto-approval: System halts at `*_review` phases
   - "Generate" button only advances to next pending step after approval

3. **Step-Specific Rules**
   - **Step 0**: Must produce valid spatial map with rooms + adjacency graph
   - **Step 1 (Top-Down 3D)**: Geometry establishment only (layout, walls, openings). No furniture or style.
   - **Step 2 (Style)**: Style-only changes. NO geometry, layout, scale, or furniture changes allowed.
   - **Step 3 (Camera Planning)**: Cameras must have explicit position (x, y), yaw, FOV, and room binding. Manual placement required.
   - **Step 4 (Space Detection)**: Detected spaces must map to rooms from Step 0 graph. No hallucinated rooms.
   - **Step 5-7**: Each render/panorama tied to specific camera marker with adjacency context for consistency.

4. **QA Enforcement Rule: "Nice But Wrong" = REJECT**
   - If output looks good BUT violates architectural rules → REJECT
   - Examples:
     - Beautiful render with furniture added (Step 1 should have no furniture) → REJECT
     - Styled image with layout changes (Step 2 should preserve geometry) → REJECT
     - Panorama with rooms that don't exist in spatial graph → REJECT
   - QA must cite specific violated rules in `violated_rules` array

5. **No Hallucinations**
   - Never generate rooms or openings not present in Step 0 spatial analysis
   - Camera markers must bind to real room_ids from `floorplan_pipeline_spaces`
   - Adjacency context must match Step 0 graph

6. **Retry Logic**
   - Max 3 attempts per step by default
   - Exponential backoff: 1s, 2s, 4s delays
   - Failed steps after max attempts → pipeline state: `failed`
   - User can manually retry via "Retry Pipeline" button

7. **State Integrity**
   - Database trigger enforces `whole_apartment_phase` ↔ `current_step` consistency
   - Any mismatch auto-corrects and logs as `STATE_INTEGRITY_AUTO_CORRECTED` event
   - Steps cannot regress (current_step can only increment or stay same)

### "Do Not" Rules

#### Security
- ❌ **NEVER** expose private API keys in frontend (only VITE_* env vars)
- ❌ **NEVER** allow direct database writes from frontend (use Edge Functions with RLS)
- ❌ **NEVER** skip Row Level Security policies

#### Data Integrity
- ❌ **NEVER** delete data automatically without explicit user action
- ❌ **NEVER** modify `floorplan_pipelines` table schema without migration
- ❌ **NEVER** change column names or types in existing tables
- ❌ **NEVER** skip phase validation in Edge Functions

#### Pipeline Logic
- ❌ **NEVER** auto-advance past review phases without manual approval
- ❌ **NEVER** skip Step 0 (Space Analysis) - it's the foundation
- ❌ **NEVER** allow Step 2 to change geometry (style-only)
- ❌ **NEVER** generate renders without confirmed camera plan (Step 3 → Step 5)
- ❌ **NEVER** approve outputs that violate architectural rules, even if visually appealing

#### Error Handling
- ❌ **NEVER** silently fail - always log errors to `floorplan_pipeline_events`
- ❌ **NEVER** lose error context - store full stack trace in `last_error`
- ❌ **NEVER** continue pipeline if critical step fails (halt for user intervention)

---

## 🏗️ Architectural Invariants

### System State
- **Phase:** Protocol 0 - Initialization (Blueprint definition in progress)
- **Current Layer:** Discovery Complete → Schema Defined
- **External Dependencies:**
  - **Supabase** (Database, Storage, Auth, Edge Functions)
  - **Google Gemini** (EXCLUSIVE LLM provider via API_NANOBANANA)
    - Image-to-image generation
    - Text analysis and prompt composition
    - QA evaluation and style analysis
  - **Langfuse** (MANDATORY observability, prompt management, traces)

### Technical Constraints

#### Frontend (Layer: UI/UX)
- **Framework**: React 18.3 + Vite 5.4
- **Language**: TypeScript 5.8
- **UI Library**: shadcn/ui (Radix UI primitives) + Tailwind CSS
- **State Management**: @tanstack/react-query for server state
- **Routing**: react-router-dom v6.30
- **Forms**: react-hook-form + zod validation
- **Real-time**: Supabase Realtime subscriptions (WebSocket)

#### Backend (Layer: API/Functions)
- **Runtime**: Deno (TypeScript-native, Edge Functions)
- **Database**: PostgreSQL 15+ via Supabase
- **Storage**: Supabase Storage (S3-compatible, private buckets)
- **Auth**: Supabase Auth (JWT-based, RLS-enforced)
- **Edge Functions**: 59 deployed functions in `supabase/functions/`

#### Database Schema Rules
- **Primary Keys**: UUID v4 (`gen_random_uuid()`)
- **Timestamps**: `TIMESTAMPTZ` with `DEFAULT now()`
- **Row Level Security**: ALL tables have RLS enabled with user-scoped policies
- **Foreign Keys**: Cascading deletes NOT used (explicit deletion only)
- **Enums**: Defined as `TEXT CHECK (column IN (...))` constraints
- **JSONB**: Used for flexible schemas (step_outputs, retry_state, style_profile)
- **Indexes**: Composite indexes on (pipeline_id, step_number) for fast queries
- **Triggers**:
  - `update_*_updated_at` → auto-update timestamps
  - `enforce_phase_step_consistency` → auto-correct phase/step mismatches
  - `log_state_integrity_correction` → audit state fixes

#### Pipeline Architecture Rules

1. **Phase-Driven State Machine**
   - Single source of truth: `floorplan_pipelines.whole_apartment_phase`
   - Phase → Step mapping enforced by `PHASE_ACTION_CONTRACT` (pipeline-action-contract.ts)
   - Endpoint → Phase validation via `ENDPOINT_ALLOWED_PHASES`

2. **8-Step Linear Workflow**
   ```
   Step 0: Space Analysis (upload → spatial_map)
   Step 1: Top-Down 3D (geometry only)
   Step 2: Style (style only, no geometry)
   Step 3: Camera Planning (manual marker placement)
   Step 4: Space Detection (room identification)
   Step 5: Renders (A/B per camera × space)
   Step 6: Panoramas (A/B 360° per space)
   Step 7: Merge (final 360° per space)
   ```

3. **Deterministic Routing**
   - ALL frontend mutations use `routeActionByPhase()` from `pipeline-router.ts`
   - NO direct endpoint calls from components/hooks
   - Action context logged with `action_id`, `phase_at_click`, `timestamp`

4. **Retry & Recovery**
   - Max 3 attempts per step (configurable in `step_retry_state`)
   - Exponential backoff: 1s, 2s, 4s
   - Dead Letter Queue: Failed pipelines with `status: "failed"`
   - Manual recovery via "Retry Pipeline" CTA

5. **QA Architecture**
   - LLM-as-Judge: Automated evaluation stored in `qa_judge_results`
   - Human feedback: User corrections stored in `qa_human_feedback`
   - Policy learning: Aggregated rules in `qa_policy_rules`
   - A/B testing: `ab_bucket` field for prompt variant testing
   - Langfuse integration: All QA evaluations traced for analysis

6. **Event Sourcing (Partial)**
   - All state transitions logged to `floorplan_pipeline_events`
   - Event types: `STEP_START`, `STEP_COMPLETE`, `STEP_FAILED`, `STEP_MANUAL_APPROVED`, `STEP_MANUAL_REJECTED`, `STATE_INTEGRITY_AUTO_CORRECTED`
   - Realtime subscriptions for live updates

### File Structure Invariants

```
A:\RE-TOUR\
├── gemini.md           ← THIS FILE (Project Constitution - LAW)
├── task_plan.md        ← Phase tracking & checklist
├── findings.md         ← Research & discoveries
├── progress.md         ← Session log & results
├── .env                ← Frontend keys only (VITE_*)
│
├── src/                ← React frontend
│   ├── components/     ← UI components (194 TypeScript files)
│   ├── lib/            ← Utilities (pipeline-router, utils, etc.)
│   └── App.tsx         ← Root component
│
├── supabase/
│   ├── functions/      ← 59 Edge Functions (Deno)
│   │   ├── run-pipeline-step/
│   │   ├── continue-pipeline-step/
│   │   ├── run-space-analysis/
│   │   ├── run-detect-spaces/
│   │   └── ... (batch jobs, QA, cameras, etc.)
│   └── migrations/     ← 62 SQL migration files
│
├── architecture/       ← TO BE CREATED (Layer 1: SOPs)
├── tools/              ← TO BE CREATED (Layer 3: Python automation scripts)
└── .tmp/               ← TO BE CREATED (Temporary workbench)
```

### Integration Constraints

#### API Rate Limits
- **Google Gemini**: 60 requests/minute (ALL LLM tasks: generation, analysis, QA, prompt composition)
- **NanoBanana**: 10 concurrent generations (GPU pool limit)
- **Langfuse**: Unlimited traces (cloud or self-hosted)

#### Storage Limits
- **Supabase Storage**: 100 GB total (private buckets)
- **Image Upload**: Max 10 MB per file (enforced client-side)
- **Output Quality**: 2K (1920×1080) default, 4K optional

#### Security Constraints
- **Frontend**: Only public `VITE_*` env vars
- **Backend**: Private keys stored in Supabase Secrets (accessed by Edge Functions)
- **Storage**: RLS policies extract `user_id` from path: `storage.foldername(name)[1]`
- **API Keys**: NEVER committed to git (`.env` in `.gitignore`)

### Deployment Architecture

- **Frontend**: Hosted on Lovable (Vite build deployed)
- **Backend**: Supabase Cloud (managed Postgres + Storage + Edge Functions)
- **Edge Functions**: Auto-deployed via Supabase CLI (`supabase functions deploy`)
- **Database Migrations**: Applied via `supabase db push` (version-controlled in `supabase/migrations/`)

### Observability Stack

- **Langfuse**: Prompt versioning, trace visualization, A/B test analysis
- **Supabase Logs**: Edge Function execution logs (stdout/stderr)
- **Realtime Events**: Live pipeline progress via `floorplan_pipeline_events` table
- **QA Metrics**: Aggregated in `qa_calibration_stats` (false reject/approve rates)

---

## 🔧 Maintenance Log

| Date | Change | Reason | Impact |
|------|--------|--------|--------|
| 2026-02-08 15:11 | Blueprint initialized | Project start | Memory system created |
| 2026-02-08 15:30 | Discovery Questions answered | User provided North Star + integrations | Mission defined |
| 2026-02-08 15:35 | Database schema explored | Analyzed 62 Supabase migrations | Complete data model documented |
| 2026-02-08 15:40 | External research completed | Production patterns for automation | Architectural patterns identified |
| 2026-02-08 15:45 | Data schemas defined | Schema-first design principle | Input/Output/State schemas proposed |
| 2026-02-08 15:45 | Behavioral rules documented | User-provided constraints | QA rules + "Do Not" rules established |
| 2026-02-08 15:45 | Architectural invariants set | Existing codebase analysis | Technical constraints + file structure defined |
| 2026-02-08 16:00 | **Reality validation gate added** | User clarification: living blueprint | Patterns are defaults; must validate against real pipeline before Phase 3 |
| 2026-02-08 16:25 | **Critical corrections applied** | User corrections: OpenAI removed, Langfuse mandatory | Gemini is EXCLUSIVE LLM provider; Langfuse is MANDATORY (not optional) |

---

**⚠️ This document is a LIVING BLUEPRINT. Schemas and patterns will evolve based on real system behavior.**
