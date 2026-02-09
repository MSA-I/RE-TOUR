# Step 2 QA Format - Exact Integration Instructions

## Location Found

**File**: `src/components/WholeApartmentPipelineCard.tsx`
**Line**: 1363 (inside the Step 2 section)

Currently, Step 2 uses `StageReviewPanel` which only shows the latest output with a before/after slider.

---

## Integration Strategy

We'll **ADD** the new `Step2OutputsPanel` component **BELOW** the existing `StageReviewPanel` to show all attempts with scoring, while keeping the before/after comparison above.

---

## Step-by-Step Instructions

### 1. Add Import at Top of File

**File**: `src/components/WholeApartmentPipelineCard.tsx`

Find the imports section (around line 1-30) and add:

```tsx
import { Step2OutputsPanel } from "@/components/whole-apartment/Step2OutputsPanel";
import { useStepAttempts } from "@/hooks/useStepAttempts";
```

### 2. Add Hook to Fetch Step 2 Attempts

**File**: `src/components/WholeApartmentPipelineCard.tsx`

Find where the component starts (around line 500) and add this hook after the existing hooks:

```tsx
export function WholeApartmentPipelineCard({
  pipeline,
  // ... other props
}: WholeApartmentPipelineCardProps) {
  // ... existing hooks ...

  // ADD THIS: Fetch Step 2 attempts for detailed QA review
  const { data: step2Attempts, isLoading: isLoadingStep2Attempts } = useStepAttempts(
    pipeline.id,
    2 // Step number
  );

  // ... rest of component ...
}
```

### 3. Add Step2OutputsPanel Below StageReviewPanel

**File**: `src/components/WholeApartmentPipelineCard.tsx`
**Location**: After line 1405 (after the closing `</div>` of Step 2 section)

**Find this code** (around line 1361-1406):

```tsx
{/* Step 2 Review Panel with Before/After - ALWAYS show when output exists and needs review */}
{step2Asset && !step2Blocked && (step2Review || step2Done || (manualQAEnabled && step2HasOutput && !step2ManualApproved && step1Done)) && (
  <div className="space-y-2">
    <StageReviewPanel
      title="Style Top-Down"
      stepNumber={2}
      // ... existing props ...
    />

    {/* Step 2 Controls Footer (Reset + Back to Step 1) */}
    <StepControlsFooter
      stepNumber={2}
      // ... existing props ...
    />
  </div>
)}
```

**CHANGE TO:**

```tsx
{/* Step 2 Review Panel with Before/After - ALWAYS show when output exists and needs review */}
{step2Asset && !step2Blocked && (step2Review || step2Done || (manualQAEnabled && step2HasOutput && !step2ManualApproved && step1Done)) && (
  <div className="space-y-2">
    <StageReviewPanel
      title="Style Top-Down"
      stepNumber={2}
      // ... existing props (keep as-is) ...
    />

    {/* NEW: All Attempts Panel with Manual Scoring (like Multi Panoramas) */}
    {step2Attempts && step2Attempts.length > 0 && (
      <div className="mt-4">
        <Step2OutputsPanel
          pipelineId={pipeline.id}
          projectId={pipeline.project_id}
          attempts={step2Attempts}
          isLoading={isLoadingStep2Attempts}
        />
      </div>
    )}

    {/* Step 2 Controls Footer (Reset + Back to Step 1) */}
    <StepControlsFooter
      stepNumber={2}
      // ... existing props (keep as-is) ...
    />
  </div>
)}
```

### 4. Create useStepAttempts Hook (if it doesn't exist)

**Check if file exists**: `src/hooks/useStepAttempts.ts`

If it **doesn't exist**, create it:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StepAttempt {
  id: string;
  attempt_index: number;
  output_upload_id: string;
  created_at: string;
  qa_status: string | null;
  qa_decision: string | null;
  qa_reason: string | null;
  qa_score: number | null;
}

export function useStepAttempts(pipelineId: string, stepNumber: number) {
  return useQuery({
    queryKey: ["step-attempts", pipelineId, stepNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floorplan_pipeline_step_attempts")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .eq("step_number", stepNumber)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as StepAttempt[];
    },
    enabled: !!pipelineId && stepNumber > 0,
  });
}

export type { StepAttempt };
```

---

## What This Achieves

### Before Integration:
```
Step 2: Style Top-Down
┌──────────────────────────────┐
│ Before/After Slider          │
│ (Only shows latest output)   │
└──────────────────────────────┘
[Approve] [Reject] [Continue]
```

### After Integration:
```
Step 2: Style Top-Down
┌──────────────────────────────┐
│ Before/After Slider          │
│ (Quick comparison)           │
└──────────────────────────────┘

All Attempts (Both approved and rejected)
┌──────────────────────────────┐
│ Attempt #1    Score: 85 ✓    │
│ [Image]                      │
│ Score: [85] Excellent        │
│ Note: [Great colors]         │
│ [Approve] [Reject]           │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Attempt #2    Score: 45 ✗    │
│ [Image]                      │
│ Score: [45] Fair             │
│ Note: [Furniture wrong]      │
│ [Approve] [Reject]           │
└──────────────────────────────┘

[Reset Step 2] [Back to Step 1]
```

---

## Testing Checklist

After making these changes:

1. ✅ **Compile check**: `npm run dev` (no TypeScript errors)
2. ✅ **Run Step 2**: Generate styled outputs
3. ✅ **Verify both panels show**:
   - Top: Before/After slider (existing)
   - Bottom: All attempts with scoring (new)
4. ✅ **Test scoring**: Enter score + note, click Approve
5. ✅ **Check database**:
   ```sql
   SELECT qa_score, qa_reason
   FROM floorplan_pipeline_step_attempts
   WHERE step_number = 2;
   ```
6. ✅ **Check feedback persistence**:
   ```sql
   SELECT * FROM qa_attempt_feedback WHERE step_id = 2;
   ```

---

## Rollback (if needed)

If anything breaks, simply remove the lines you added:
1. Remove the `<Step2OutputsPanel />` block
2. Remove the `useStepAttempts` hook call
3. Remove the imports

The existing `StageReviewPanel` will continue working as before.

---

## Summary

**What to change**:
1. Add 2 imports
2. Add 1 hook call
3. Add 1 JSX block (5 lines)
4. Create 1 new file (useStepAttempts.ts) if it doesn't exist

**Result**:
- ✅ Keep existing before/after comparison
- ✅ Add all attempts panel below it
- ✅ Manual scoring (0-100 + note)
- ✅ QA learning integration
- ✅ Same format as Multi Panoramas

Ready to implement!
