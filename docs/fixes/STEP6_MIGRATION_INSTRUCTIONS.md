# Step 6 Migration Instructions

**Date**: 2026-02-12
**Migration File**: `supabase/migrations/20260212000000_add_final_prompts_output_fields.sql`
**Purpose**: Add output and QA fields to `final_prompts` table for Step 6 integration

---

## Migration Overview

This migration adds the following fields to the `final_prompts` table:

### Output Fields
- `output_upload_ids` - Array of upload IDs for generated images
- `attempt_number` - Retry tracking (1 = first attempt)

### QA Fields
- `qa_status` - QA decision (approved/failed/pending)
- `qa_report` - Detailed QA report (jsonb)
- `qa_score` - Numeric QA score
- `qa_feedback` - Human-readable feedback
- `qa_reason` - Rejection reason (if failed)

### Approval Fields
- `manual_approved` - Manual QA override flag
- `locked_approved` - Locked approval state
- `approved_at` - Approval timestamp
- `approved_by` - User who approved (FK to auth.users)

### Indexes
- `idx_final_prompts_qa_status` - Query by QA status
- `idx_final_prompts_approved` - Query approved outputs
- `idx_final_prompts_attempt` - Query by attempt number

---

## How to Apply the Migration

### Option 1: Supabase CLI (Recommended)

```bash
# Navigate to project root
cd A:/RE-TOUR

# Apply the migration
supabase db push

# Or apply specific migration
supabase migration up
```

### Option 2: Supabase SQL Editor

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `supabase/migrations/20260212000000_add_final_prompts_output_fields.sql`
5. Paste into the editor
6. Click **Run** or press `Ctrl+Enter`

---

## Verification Steps

After applying the migration, run these queries in the Supabase SQL Editor to verify success:

### 1. Verify All Columns Exist

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'final_prompts'
AND column_name IN (
  'output_upload_ids', 'qa_status', 'qa_report', 'qa_score', 'qa_feedback', 'qa_reason',
  'manual_approved', 'locked_approved', 'attempt_number', 'approved_at', 'approved_by'
)
ORDER BY ordinal_position;
```

**Expected Result:** 11 rows (one for each new column)

### 2. Verify Indexes Exist

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'final_prompts'
AND indexname IN (
  'idx_final_prompts_qa_status',
  'idx_final_prompts_approved',
  'idx_final_prompts_attempt'
);
```

**Expected Result:** 3 rows (one for each index)

### 3. Verify Foreign Key Constraint

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'final_prompts'
AND constraint_name = 'final_prompts_approved_by_fkey';
```

**Expected Result:** 1 row showing FOREIGN KEY constraint

### 4. Verify Table Structure

```sql
-- Get complete table structure
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  character_maximum_length
FROM information_schema.columns
WHERE table_name = 'final_prompts'
ORDER BY ordinal_position;
```

**Expected Result:** Should show all original columns plus 11 new columns

---

## Next Steps After Migration

### Step 1: Update TypeScript Interface ✅ (Already Done)

The `FinalPrompt` interface in `src/contexts/PipelineContext.tsx` needs to be updated.

**File**: `src/contexts/PipelineContext.tsx`

Add these fields to the `FinalPrompt` interface:

```typescript
export interface FinalPrompt {
  // ... existing fields ...

  // Output fields
  output_upload_ids?: string[];
  attempt_number?: number;

  // QA fields
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
  qa_reason?: string;

  // Approval fields
  manual_approved?: boolean;
  locked_approved?: boolean;
  approved_at?: string;
  approved_by?: string;
}
```

### Step 2: Update Backend Edge Function

**File**: `supabase/functions/run-batch-space-outputs/index.ts`

**Changes Needed:**

1. **After NanoBanana job completes:**
   ```typescript
   // Store output upload IDs
   const { data: updatedPrompt } = await supabase
     .from('final_prompts')
     .update({
       output_upload_ids: generatedImageUploadIds, // Array of upload IDs
       status: 'complete'
     })
     .eq('id', promptId)
     .select()
     .single();
   ```

2. **Run QA validation:**
   ```typescript
   // Call QA service (similar to Steps 1 & 2)
   const qaResult = await runQAValidation({
     images: generatedImageUploadIds,
     prompt: prompt.final_composed_prompt,
     space_class: space.class
   });

   // Store QA results
   await supabase
     .from('final_prompts')
     .update({
       qa_status: qaResult.decision,
       qa_report: qaResult.report,
       qa_score: qaResult.score,
       qa_feedback: qaResult.feedback,
       qa_reason: qaResult.reason
     })
     .eq('id', promptId);
   ```

3. **Handle approval:**
   ```typescript
   // When user approves
   const { data } = await supabase
     .from('final_prompts')
     .update({
       locked_approved: true,
       approved_at: new Date().toISOString(),
       approved_by: userId
     })
     .eq('id', promptId)
     .select()
     .single();
   ```

### Step 3: Update Step 6 Frontend Component

**File**: `src/components/whole-apartment/steps/Step6_OutputsQA.tsx`

**Changes to Make:**

1. **Build StageReviewAsset for each space:**
   ```typescript
   const spaceAssets: Array<{ space: PipelineSpace; asset: StageReviewAsset }> =
     completedPrompts
       .filter(p => p.output_upload_ids && p.output_upload_ids.length > 0)
       .map(prompt => {
         const space = spaces.find(s => s.id === prompt.space_id);
         return {
           space: space!,
           asset: {
             id: `step6-${prompt.id}`,
             uploadId: prompt.output_upload_ids![0], // First output as main
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
   ```

2. **Add per-space approval handlers:**
   ```typescript
   const handleApproveSpace = async (spaceId: string) => {
     try {
       const prompt = finalPrompts.find(p => p.space_id === spaceId);
       if (!prompt) return;

       // Call backend to approve
       await supabase
         .from('final_prompts')
         .update({
           locked_approved: true,
           approved_at: new Date().toISOString(),
           approved_by: userId
         })
         .eq('id', prompt.id);

       // Refetch
       refetchFinalPrompts();

       toast({
         title: "Space Output Approved",
         description: `${getSpaceName(spaceId)} has been approved.`,
       });
     } catch (error) {
       console.error("Failed to approve space:", error);
       toast({
         title: "Approval Failed",
         description: error instanceof Error ? error.message : "Unknown error",
         variant: "destructive"
       });
     }
   };

   const handleRejectSpace = async (spaceId: string, notes: string) => {
     try {
       const prompt = finalPrompts.find(p => p.space_id === spaceId);
       if (!prompt) return;

       // Call backend to reject and retry
       // TODO: Implement retry logic

       toast({
         title: "Space Output Rejected",
         description: `${getSpaceName(spaceId)} will be regenerated.`,
         variant: "destructive"
       });
     } catch (error) {
       console.error("Failed to reject space:", error);
     }
   };
   ```

3. **Replace output list with StageReviewPanel:**
   ```typescript
   {/* Per-Space Output Display */}
   {spaceAssets.length > 0 && (
     <div className="space-y-6">
       <p className="text-sm font-medium">Generated Outputs by Space:</p>
       {spaceAssets.map(({ space, asset }) => (
         <StageReviewPanel
           key={asset.id}
           title={`${space.name} (${space.class})`}
           stepNumber={6}
           currentStep={pipeline.current_step || 0}
           beforeUploadId={step2UploadId || null} // Styled plan from Step 2
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
     </div>
   )}
   ```

4. **Add batch approval button:**
   ```typescript
   {isReview && spaceAssets.length > 0 && (
     <div className="space-y-2">
       <Button
         onClick={handleApproveAllSpaces}
         disabled={spaceAssets.some(s => !s.asset.qaStatus || s.asset.qaStatus !== 'approved')}
         className="gap-2 w-full"
       >
         <ThumbsUp className="w-4 h-4" />
         Approve All Spaces ({spaceAssets.length})
       </Button>
       <p className="text-xs text-muted-foreground text-center">
         All spaces must pass QA to approve in batch
       </p>
     </div>
   )}
   ```

---

## Testing Checklist

After completing all steps above:

### Backend Testing
- [ ] Migration applied successfully
- [ ] All columns exist in `final_prompts` table
- [ ] All indexes created
- [ ] Foreign key constraint active
- [ ] `run-batch-space-outputs` function populates new fields
- [ ] QA validation runs and stores results
- [ ] Approval updates work correctly

### Frontend Testing
- [ ] TypeScript interface updated (no type errors)
- [ ] Step 6 component builds without errors
- [ ] Per-space outputs display with images
- [ ] QA status/report shows correctly
- [ ] Approval button enabled when QA passes
- [ ] Rejection triggers retry (if implemented)
- [ ] Batch approval works
- [ ] Locked approval prevents changes

### E2E Testing
- [ ] Create new pipeline
- [ ] Complete Steps 0-5
- [ ] Generate outputs in Step 6
- [ ] Review per-space QA results
- [ ] Approve/reject individual spaces
- [ ] Use batch approval for all spaces
- [ ] Verify locked approval state
- [ ] Continue to Step 7/8

---

## Rollback Plan

If the migration causes issues:

```sql
-- Remove all new columns (DANGER: Loses data)
ALTER TABLE final_prompts
  DROP COLUMN IF EXISTS output_upload_ids,
  DROP COLUMN IF EXISTS qa_status,
  DROP COLUMN IF EXISTS qa_report,
  DROP COLUMN IF EXISTS qa_score,
  DROP COLUMN IF EXISTS qa_feedback,
  DROP COLUMN IF EXISTS qa_reason,
  DROP COLUMN IF EXISTS manual_approved,
  DROP COLUMN IF EXISTS locked_approved,
  DROP COLUMN IF EXISTS attempt_number,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

-- Drop indexes
DROP INDEX IF EXISTS idx_final_prompts_qa_status;
DROP INDEX IF EXISTS idx_final_prompts_approved;
DROP INDEX IF EXISTS idx_final_prompts_attempt;
```

**⚠️ WARNING:** This will delete all data in these columns. Only use if necessary.

---

## Success Criteria

Migration is successful when:
- ✅ All 11 new columns exist in `final_prompts` table
- ✅ All 3 indexes created
- ✅ Foreign key constraint active
- ✅ No errors in verification queries
- ✅ TypeScript interface updated
- ✅ Backend function updated
- ✅ Step 6 UI displays per-space outputs
- ✅ E2E pipeline test passes

---

**Status**: Migration ready to apply
**Next Action**: Apply migration in Supabase SQL Editor or CLI
**Documentation**: See `STAGEREW_PANEL_INTEGRATION_STATUS.md` for full context
