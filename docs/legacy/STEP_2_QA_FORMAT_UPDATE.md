# Step 2 QA Format Update - Implementation Guide

## What Was Created

**New Component**: `src/components/whole-apartment/Step2OutputsPanel.tsx`

This component displays Step 2 outputs in the **same format as Multi Panoramas**:
- ✅ Shows **ALL attempts** (both approved and rejected)
- ✅ **Numeric score input** (0-100) for each attempt
- ✅ **Explanation text field** for manual feedback
- ✅ **Feeds into QA learning system** via `qa_attempt_feedback` table
- ✅ Image preview with click-to-expand
- ✅ Shows existing auto-QA scores and reasons
- ✅ Allows manual override of QA decisions

---

## How to Integrate

### Step 1: Find Where Step 2 Outputs Are Currently Displayed

Look in:
- `src/pages/ProjectDetail.tsx` (main pipeline page)
- Or wherever Step 2 results are shown

### Step 2: Replace with New Component

**Before** (example - adjust to your actual code):
```tsx
// Old code showing Step 2 outputs
<div>
  {step2Output && <img src={step2Output.url} />}
  {/* ... some basic display ... */}
</div>
```

**After**:
```tsx
import { Step2OutputsPanel } from "@/components/whole-apartment/Step2OutputsPanel";
import { useStepAttempts } from "@/hooks/useStepAttempts";

// Inside your component:
const { data: step2Attempts, isLoading: isLoadingAttempts } = useStepAttempts(
  pipeline.id,
  2 // Step number
);

// Render:
<Step2OutputsPanel
  pipelineId={pipeline.id}
  projectId={pipeline.project_id}
  attempts={step2Attempts || []}
  isLoading={isLoadingAttempts}
/>
```

### Step 3: Ensure useStepAttempts Hook Exists

If `useStepAttempts` doesn't exist, create it:

**File**: `src/hooks/useStepAttempts.ts`

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
```

---

## Features

### 1. Show All Attempts

**Before**: Only latest or only rejected attempts visible

**After**: All attempts shown in a list:
- Approved attempts: Green badge
- Rejected attempts: Red badge
- Needs review: Yellow badge

### 2. Manual Scoring with QAReviewPanel

Each attempt has:
```
┌─────────────────────────────────────┐
│ [Image Preview]                     │
│                                     │
│ Quality Score (0–100)               │
│ [  85  ] Excellent                  │
│                                     │
│ Feedback Note                       │
│ [Text area for explanation]         │
│                                     │
│ [Approve] [Reject]                  │
└─────────────────────────────────────┘
```

### 3. QA Learning Integration

When user submits score + explanation:
1. Updates `floorplan_pipeline_step_attempts.qa_score` and `qa_reason`
2. Creates record in `qa_attempt_feedback` table (via QAReviewPanel's `autoPersistFeedback`)
3. Future QA runs use this feedback to learn user preferences

### 4. Shows Auto-QA Results

If auto-QA already scored the attempt:
- **Auto-QA score** shown in badge
- **Auto-QA reason** shown in colored box
- User can **override** with manual score/reason

---

## Testing

After integration:

1. **Run Step 2** to generate styled outputs
2. **Check that ALL attempts appear** (not just the latest)
3. **Verify score input** (0-100) is visible for each
4. **Enter score + explanation** and click Approve/Reject
5. **Check database**:
   ```sql
   SELECT qa_score, qa_reason, qa_status
   FROM floorplan_pipeline_step_attempts
   WHERE step_number = 2
   ORDER BY created_at DESC;
   ```
6. **Verify feedback persistence**:
   ```sql
   SELECT *
   FROM qa_attempt_feedback
   WHERE step_id = 2
   ORDER BY created_at DESC;
   ```

---

## Comparison: Before vs After

### Before

```
Step 2 Output
┌────────────┐
│ [Image]    │
│ Status: ✓  │
└────────────┘
```
- Only shows latest or only rejected
- No manual scoring
- No explanation field
- Doesn't feed into QA learning

### After (Like Multi Panoramas)

```
Attempt #1          Score: 85/100 ✓ Approved
┌────────────────────────────────────────────┐
│ [Image Preview - Click to Expand]         │
├────────────────────────────────────────────┤
│ Auto-QA: Approved (Score: 85)             │
│ Reason: All checks passed                 │
├────────────────────────────────────────────┤
│ Manual Review:                            │
│ Quality Score (0–100): [85] Excellent     │
│ Feedback: [Great quality, good colors]    │
│ [Approve] [Reject]                        │
└────────────────────────────────────────────┘

Attempt #2          Score: 45/100 ✗ Rejected
┌────────────────────────────────────────────┐
│ [Image Preview - Click to Expand]         │
├────────────────────────────────────────────┤
│ Auto-QA: Rejected (Score: 45)             │
│ Reason: [furniture_mismatch] Single bed   │
│         changed to double bed             │
├────────────────────────────────────────────┤
│ Manual Review:                            │
│ Quality Score (0–100): [45] Fair          │
│ Feedback: [Agree, furniture wrong]        │
│ [Approve] [Reject]                        │
└────────────────────────────────────────────┘
```

---

## Summary

**What This Achieves:**

1. ✅ **Format matches Multi Panoramas** (consistent UX)
2. ✅ **All attempts visible** (approved + rejected)
3. ✅ **Manual scoring** (0-100 + explanation)
4. ✅ **Feeds QA learning** (via `qa_attempt_feedback`)
5. ✅ **Shows auto-QA results** (with manual override option)

**What You Need to Do:**

1. Find where Step 2 outputs are currently displayed
2. Replace with `<Step2OutputsPanel />` component
3. Ensure `useStepAttempts` hook exists (or create it)
4. Test that all attempts appear with scoring UI

**Result**: Step 2 will have the same professional QA interface as Multi Panoramas, with full QA learning integration.

---

## Need Help?

If you need help finding where to integrate this component, share:
1. The file where Step 2 outputs are currently shown
2. A screenshot of the current Step 2 display

I can then provide specific integration code for your setup.
