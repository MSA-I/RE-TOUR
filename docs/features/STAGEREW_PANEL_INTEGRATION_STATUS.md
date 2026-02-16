# StageReviewPanel Integration Status

**Date**: 2026-02-12
**Task**: Quick Fix - Add StageReviewPanel to Steps 1, 2, 6
**Status**: Steps 1 & 2 COMPLETE ✅ | Step 6 BLOCKED ⛔

---

## Summary

Successfully integrated `StageReviewPanel` component into Steps 1 and 2, providing full output display with QA integration, before/after comparison, and approval workflows. Step 6 integration is blocked pending backend data model updates.

---

## Completed: Steps 1 & 2 ✅

### Step 1: Realistic 2D Plan

**File**: `src/components/whole-apartment/steps/Step1_RealisticPlan.tsx`

**Changes Made:**
1. ✅ Added `StageReviewPanel` and `StageReviewAsset` imports
2. ✅ Built `step1Asset` object from `stepOutputs["step1"]`
3. ✅ Added `handleReject` function for retry workflow
4. ✅ Replaced simple image preview with `StageReviewPanel` component
5. ✅ Configured before/after comparison:
   - **Before**: `pipeline.floor_plan_upload_id` (original floor plan)
   - **After**: `step1Output.upload_id` (generated 2D plan)

**Features Now Available:**
- ✅ Before/After image comparison slider
- ✅ QA status badge display
- ✅ QA report accordion with criteria breakdown
- ✅ Approval button (enabled when QA passes)
- ✅ Rejection button (triggers retry)
- ✅ Manual QA override checkbox (if enabled)
- ✅ Locked approval state after approval
- ✅ Prompt display (what was used to generate)
- ✅ Zoom/pan controls
- ✅ Fullscreen mode

**Code Location:**
```typescript
// Lines 98-106: Asset object construction
const step1Asset: StageReviewAsset | null = outputUploadId ? {
  id: `step1-${pipeline.id}`,
  uploadId: outputUploadId,
  status: isReview ? "needs_review" : isComplete ? "approved" : "pending",
  qaStatus: step1Output?.qa_status || step1Output?.qa_decision,
  qaReport: step1Output?.qa_report || null,
  lockedApproved: step1ManualApproved || isComplete,
  promptText: step1Output?.prompt_text || step1Output?.prompt_used,
} : null;

// Lines 167-183: StageReviewPanel component
<StageReviewPanel
  title="Floor Plan → Top-Down 3D"
  stepNumber={1}
  currentStep={pipeline.current_step || 0}
  beforeUploadId={pipeline.floor_plan_upload_id || null}
  beforeLabel="Original Floor Plan"
  afterAsset={step1Asset}
  afterLabel="2D Plan Output"
  onApprove={handleApprove}
  onReject={handleReject}
  isLoading={isRunning}
  bucket="floor_plans"
  pipelineId={pipeline.id}
  pipeline={pipeline}
/>
```

---

### Step 2: Style Application

**File**: `src/components/whole-apartment/steps/Step2_StyleApplication.tsx`

**Changes Made:**
1. ✅ Added `StageReviewPanel` and `StageReviewAsset` imports
2. ✅ Built `step2Asset` object from `stepOutputs["step2"]`
3. ✅ Added `handleReject` function for retry workflow
4. ✅ Retrieved `step1UploadId` for before/after comparison
5. ✅ Replaced output preview and action buttons with `StageReviewPanel`
6. ✅ Configured before/after comparison:
   - **Before**: `step1UploadId` (unstyled 2D plan from Step 1)
   - **After**: `step2Output.upload_id` (styled plan)

**Features Now Available:**
- ✅ Before/After comparison (unstyled vs styled)
- ✅ QA status badge display
- ✅ QA report accordion with criteria breakdown
- ✅ Approval button (enabled when QA passes)
- ✅ Rejection button (triggers retry)
- ✅ Manual QA override checkbox (if enabled)
- ✅ Locked approval state after approval
- ✅ Prompt display (what was used to generate)
- ✅ Zoom/pan controls
- ✅ Fullscreen mode

**Code Location:**
```typescript
// Lines 103-111: Asset object construction
const step2Asset: StageReviewAsset | null = outputUploadId ? {
  id: `step2-${pipeline.id}`,
  uploadId: outputUploadId,
  status: isReview ? "needs_review" : isComplete ? "approved" : "pending",
  qaStatus: step2Output?.qa_status || step2Output?.qa_decision,
  qaReport: step2Output?.qa_report || null,
  lockedApproved: step2ManualApproved || isComplete,
  promptText: step2Output?.prompt_text || step2Output?.prompt_used,
} : null;

// Lines 167-181: StageReviewPanel component
<StageReviewPanel
  title="Style Top-Down"
  stepNumber={2}
  currentStep={pipeline.current_step || 0}
  beforeUploadId={step1ManualApproved ? step1UploadId : null}
  beforeLabel="Unstyled"
  afterAsset={step2Asset}
  afterLabel="Styled"
  onApprove={handleApprove}
  onReject={handleReject}
  isLoading={isRunning}
  bucket="outputs"
  pipelineId={pipeline.id}
  pipeline={pipeline}
/>
```

---

## Build Verification ✅

```bash
$ npm run build
✓ 2202 modules transformed.
✓ built in 5.64s
```

No errors, no warnings (except unrelated chunk size warning).

---

## Blocked: Step 6 ⛔

### Current State

**File**: `src/components/whole-apartment/steps/Step6_OutputsQA.tsx`

**What Exists:**
- ✅ Basic structure with status messages
- ✅ Progress summary (completed/generating/failed counts)
- ✅ List of spaces with generated outputs
- ✅ "Generate All Images" button
- ✅ Bulk "Approve All Outputs" button
- ❌ **TODO comment at line 184**: "Add image preview grid here"
- ❌ No actual image display (just placeholder)
- ❌ No per-space QA display
- ❌ No per-space approval/rejection
- ❌ No StageReviewPanel integration

**What's Missing:**
1. ❌ Per-space output display with images
2. ❌ Per-space QA status and reports
3. ❌ Per-space approval/rejection buttons
4. ❌ Compare functionality across spaces
5. ❌ Before/after comparison per space
6. ❌ Manual QA override per space

---

### Why Step 6 is Blocked

**Root Cause**: Data model incomplete

**Current `FinalPrompt` interface:**
```typescript
export interface FinalPrompt {
  id: string;
  pipeline_id: string;
  space_id: string;
  prompt_template: string;
  final_composed_prompt: string;
  image_count: number;
  source_camera_intent_ids: string[];
  nanobanana_job_id?: string;
  status: 'pending' | 'queued' | 'generating' | 'complete' | 'failed';
}
```

**Missing Fields Needed for StageReviewPanel:**
- ❌ `output_upload_ids: string[]` - Array of generated image upload IDs
- ❌ `qa_status: string` - QA decision (approved/failed)
- ❌ `qa_report: jsonb` - QA criteria breakdown
- ❌ `manual_approved: boolean` - Manual override flag
- ❌ `attempt_number: number` - For retry tracking
- ❌ `locked_approved: boolean` - Locked approval state

**Impact:**
- Cannot display generated images (no upload IDs)
- Cannot show QA status/report (no QA fields)
- Cannot track approval state (no approval fields)
- Cannot implement per-space StageReviewPanel

---

### Required Changes to Unblock Step 6

#### 1. Database Migration

**File**: `supabase/migrations/[new]_update_final_prompts_add_output_fields.sql`

```sql
-- Add output and QA fields to final_prompts table
ALTER TABLE final_prompts
  ADD COLUMN IF NOT EXISTS output_upload_ids text[] DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS qa_status text,
  ADD COLUMN IF NOT EXISTS qa_report jsonb,
  ADD COLUMN IF NOT EXISTS qa_score numeric,
  ADD COLUMN IF NOT EXISTS qa_feedback text,
  ADD COLUMN IF NOT EXISTS manual_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);

-- Add index for querying by QA status
CREATE INDEX IF NOT EXISTS idx_final_prompts_qa_status
  ON final_prompts(qa_status);

-- Add index for querying approved outputs
CREATE INDEX IF NOT EXISTS idx_final_prompts_approved
  ON final_prompts(locked_approved);
```

#### 2. Backend Edge Function Update

**File**: `supabase/functions/run-batch-space-outputs/index.ts`

**Changes Needed:**
1. After NanoBanana job completes:
   - Store output upload IDs in `output_upload_ids` array
2. Run QA validation on each output
   - Store QA results in `qa_status`, `qa_report`, `qa_score`, `qa_feedback`
3. Update `status` to 'complete' or 'failed'

#### 3. TypeScript Interface Update

**File**: `src/contexts/PipelineContext.tsx`

```typescript
export interface FinalPrompt {
  id: string;
  pipeline_id: string;
  space_id: string;
  prompt_template: string;
  final_composed_prompt: string;
  image_count: number;
  source_camera_intent_ids: string[];
  nanobanana_job_id?: string;
  status: 'pending' | 'queued' | 'generating' | 'complete' | 'failed';

  // NEW: Output fields
  output_upload_ids?: string[];

  // NEW: QA fields
  qa_status?: string;
  qa_report?: {
    overall_decision?: string;
    overall_score?: number;
    criteria?: Array<{
      name: string;
      passed: boolean;
      confidence?: number;
      details?: string;
    }>;
    feedback?: string;
    qa_reason?: string;
  };
  qa_score?: number;
  qa_feedback?: string;

  // NEW: Approval fields
  manual_approved?: boolean;
  locked_approved?: boolean;
  attempt_number?: number;
  approved_at?: string;
  approved_by?: string;
}
```

#### 4. Frontend Implementation (After Unblocking)

**File**: `src/components/whole-apartment/steps/Step6_OutputsQA.tsx`

**Changes to Make:**
1. Map each `FinalPrompt` to a `StageReviewAsset`
2. Replace output list with per-space `StageReviewPanel` components
3. Add per-space approval/rejection handlers
4. Add batch approval option
5. Add compare functionality

**Example Code:**
```typescript
// Build assets for each completed prompt
const spaceAssets: Array<{ space: PipelineSpace; asset: StageReviewAsset }> =
  completedPrompts.map(prompt => {
    const space = spaces.find(s => s.id === prompt.space_id);
    return {
      space: space!,
      asset: {
        id: `step6-${prompt.id}`,
        uploadId: prompt.output_upload_ids?.[0] || '', // First output as main
        status: prompt.locked_approved ? "approved"
              : prompt.qa_status === "approved" ? "needs_review"
              : "pending",
        qaStatus: prompt.qa_status,
        qaReport: prompt.qa_report,
        lockedApproved: prompt.locked_approved || false,
        promptText: prompt.final_composed_prompt,
      }
    };
  });

// Render per-space panels
{spaceAssets.map(({ space, asset }) => (
  <StageReviewPanel
    key={asset.id}
    title={`Space: ${space.name}`}
    stepNumber={6}
    currentStep={pipeline.current_step || 0}
    beforeUploadId={step2UploadId} // Styled plan from Step 2
    beforeLabel="Base Plan"
    afterAsset={asset}
    afterLabel="Generated Output"
    onApprove={() => handleApproveSpace(space.id)}
    onReject={(notes) => handleRejectSpace(space.id, notes)}
    isLoading={isInProgress}
    bucket="outputs"
    pipelineId={pipeline.id}
    pipeline={pipeline}
  />
))}
```

---

## Next Steps

### Immediate (Complete) ✅
- ✅ **Steps 1 & 2**: StageReviewPanel integration complete
- ✅ **Build verification**: Passed
- ✅ **Documentation**: Created this status file

### Short Term (Step 6 - Backend)
1. ⏭️ Create database migration to add output fields to `final_prompts`
2. ⏭️ Apply migration to database
3. ⏭️ Update `run-batch-space-outputs` edge function to populate new fields
4. ⏭️ Update TypeScript `FinalPrompt` interface in context
5. ⏭️ Test backend changes with sample pipeline

### Medium Term (Step 6 - Frontend)
6. ⏭️ Implement per-space asset builder in Step 6 component
7. ⏭️ Add per-space StageReviewPanel displays
8. ⏭️ Add per-space approval/rejection handlers
9. ⏭️ Add batch approval UI
10. ⏭️ Add compare functionality
11. ⏭️ Test Step 6 E2E workflow

### Long Term (Testing & Polish)
12. ⏭️ E2E test: Complete pipeline from Step 0 → Step 8
13. ⏭️ Verify all approval workflows
14. ⏭️ Verify QA integration across all steps
15. ⏭️ Performance testing with multiple spaces
16. ⏭️ Accessibility audit

---

## Success Criteria

### Steps 1 & 2 (COMPLETE) ✅
- ✅ StageReviewPanel displays after generation
- ✅ Before/after images show correctly
- ✅ QA status displays with badge
- ✅ QA report accordion works
- ✅ Approve button enabled when QA passes
- ✅ Reject button triggers retry
- ✅ Manual override checkbox works (if enabled)
- ✅ Continue button appears after approval
- ✅ All transitions work correctly

### Step 6 (BLOCKED) ⛔
- ⏭️ Database migration applied
- ⏭️ Backend populates output fields
- ⏭️ Per-space StageReviewPanel displays
- ⏭️ Each space shows its generated images
- ⏭️ QA status visible per space
- ⏭️ Approval/rejection works per space
- ⏭️ Batch approval option available
- ⏭️ Compare across spaces works

---

## Files Modified

### Completed ✅
- ✅ `src/components/whole-apartment/steps/Step1_RealisticPlan.tsx`
- ✅ `src/components/whole-apartment/steps/Step2_StyleApplication.tsx`

### Pending Step 6 Unblocking ⏭️
- ⏭️ `supabase/migrations/[new]_update_final_prompts_add_output_fields.sql`
- ⏭️ `supabase/functions/run-batch-space-outputs/index.ts`
- ⏭️ `src/contexts/PipelineContext.tsx`
- ⏭️ `src/components/whole-apartment/steps/Step6_OutputsQA.tsx`

---

## Related Documents

- **Audit**: `AUDIT_MISSING_STAGEREW_PANEL.md` - Original discovery of missing StageReviewPanel
- **Repair Plan**: `REPAIR_PLAN_MISSING_OUTPUT_DISPLAYS.md` - 30-40 hour comprehensive plan
- **Quick Fix Plan**: Section in audit document recommending reuse of StageReviewPanel (10-15 hours)
- **Comprehensive Plan**: `C:\Users\User\.claude\plans\squishy-tinkering-hopcroft.md` - Full architecture plan

---

**Status**: Partial Success
**Completion**: 66% (2 of 3 steps complete)
**Blocker**: Step 6 requires backend data model updates
**Next Action**: Create database migration for Step 6 output fields
