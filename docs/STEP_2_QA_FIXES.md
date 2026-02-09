# Step 2 QA Fixes - Implementation Summary

## Issues Fixed

### Issue 1: QA Using OpenAI Instead of Gemini ✅ FIXED

**Problem**: Step 2 QA was showing "QA could not run (missing API key)" because it was using an old inline OpenAI-based QA validation function.

**Root Cause**: `run-pipeline-step/index.ts` had a local `runQAValidation()` function that directly called OpenAI's API (line 3534). This was obsolete - there's a separate `run-qa-check` Edge Function that uses Gemini and has full scoring/learning capabilities.

**Fix**: Replaced the inline OpenAI QA logic with a call to the `run-qa-check` Edge Function (which uses Gemini models).

**Files Modified**:
- `supabase/functions/run-pipeline-step/index.ts:3161-3280` - Replaced runQAValidation function
- `supabase/functions/run-pipeline-step/index.ts:2359-2367` - Updated call site with new parameters

**Changes**:
```typescript
// BEFORE (OpenAI-based):
async function runQAValidation(
  input: QAImageInput,
  output: QAImageInput,
  stepNumber: number,
): Promise<QAResult> {
  // ... 500 lines of OpenAI prompts and API calls ...
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    headers: { Authorization: `Bearer ${API_OPENAI}` },
    // ...
  });
}

// AFTER (Gemini via run-qa-check):
async function runQAValidation(
  input: QAImageInput,
  output: QAImageInput,
  stepNumber: number,
  pipeline_id: string,
  project_id: string,
  user_id: string,
  output_upload_id: string | null,
  current_attempt: number,
  authHeader: string,
): Promise<QAResult> {
  const qaResponse = await fetch(`${SUPABASE_URL}/functions/v1/run-qa-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
    },
    body: JSON.stringify({
      upload_id: output_upload_id,
      qa_type: stepNumber === 2 ? "style" : "structural",
      step_id: stepNumber,
      project_id: project_id,
      pipeline_id: pipeline_id,
      current_attempt: current_attempt,
      input_signed_url: input.signedUrl,
      output_signed_url: output.signedUrl,
    }),
  });
  // Parse and return structured result with score
}
```

**Benefit**: Now uses Gemini (consistent with project requirements), includes proper scoring, and leverages the full QA learning system.

---

### Issue 2: Rejection Without Reason ✅ FIXED

**Problem**: Step 2 was rejecting outputs but not showing why it was rejected.

**Root Cause**: The old OpenAI QA logic would return `"QA check failed"` as a generic reason without specific details.

**Fix**: The `run-qa-check` Edge Function returns structured reasons with:
- `qa_score`: Numeric score 0-100
- `reasons`: Array of structured rejection reasons with categories and descriptions
- `summary`: Human-readable summary of the decision

These are now properly extracted and stored in the pipeline output:

```typescript
const decision = qaResult.qa_decision || qaResult.decision || "rejected";
const score = qaResult.qa_score != null ? qaResult.qa_score : null;
const reasons = qaResult.reasons || [];
const reason = reasons.length > 0
  ? reasons.map((r) => `[${r.category}] ${r.short_reason}`).join("; ")
  : (qaResult.summary || "QA check failed");

return {
  decision,
  reason,          // Detailed reason string
  qa_executed: true,
  qa_score: score, // Numeric score for display
  reasons: reasons.map((r) => ({
    code: r.code || r.category?.toUpperCase(),
    description: r.short_reason,
  })),
  raw_qa_result: qaResult,
};
```

**What You'll See Now**:
- Specific rejection reasons like "[furniture_mismatch] Single bed changed to double bed in Bedroom 2"
- Numeric QA score (0-100) displayed in UI
- Structured data for detailed rejection cards

---

### Issue 3: Failed Attempts Not Visible ⚠️ PARTIALLY ADDRESSED

**Problem**: User couldn't see failed attempts in the UI.

**Status**: The backend already stores attempts in `floorplan_pipeline_step_attempts` table (line 2401). The QA results are now properly populated with scores and reasons.

**What's Stored**:
- Full prompt used for generation
- Output upload IDs
- QA decision, reason, and score
- Attempt timestamp

**Frontend**: The UI components (`QARejectionCard.tsx`, `AttemptHistoryGrid.tsx`) should display these attempts. If they're not visible:
1. Check that `floorplan_pipeline_step_attempts` table has records
2. Verify the frontend is querying this table correctly
3. Check that attempt_count is incrementing properly

**Next Steps**: If attempts still don't show, we may need to update the frontend query or component to fetch/display attempts properly.

---

### Issue 4: QA Score Format Inconsistency ⚠️ NEEDS FRONTEND UPDATE

**Problem**: Step 2 QA scores should match the format used in Multi Panoramas tab (numeric score + approval with reason).

**Backend Changes**: ✅ COMPLETE
- QA now returns `qa_score` (0-100)
- Stored in `step_outputs` with `qa_score` field
- Structured reasons available for display

**Frontend Changes**: ⚠️ REQUIRED

The shared `QAReviewPanel.tsx` component (line 177-200) provides the standard format:
- Numeric score input (0-100)
- Score labels: Poor < 40, Fair < 60, Good < 80, Excellent >= 80
- Approve/Reject buttons
- Optional note field

**To apply this format to Step 2**:

1. Find the Step 2 output display component (likely in `src/components/whole-apartment/`)
2. Replace custom QA display with `QAReviewPanel` component:

```tsx
import { QAReviewPanel } from "@/components/shared/QAReviewPanel";

// In your Step 2 display component:
<QAReviewPanel
  itemId={attempt.output_upload_id}
  projectId={pipeline.project_id}
  pipelineId={pipeline.id}
  outputUploadId={attempt.output_upload_id}
  onApprove={(score, note) => handleApprove(attempt.id, score, note)}
  onReject={(score, note) => handleReject(attempt.id, score, note)}
  initialScore={attempt.qa_score} // Auto-populated from QA
  initialNote={attempt.qa_reason}
  stepId={2}
  attemptNumber={attempt.attempt_index}
  autoPersistFeedback={true}
/>
```

3. Update the display to show the QA score badge consistently:

```tsx
{attempt.qa_score != null && (
  <Badge
    variant="outline"
    className={cn(getScoreLabel(attempt.qa_score).color)}
  >
    Score: {attempt.qa_score} - {getScoreLabel(attempt.qa_score).text}
  </Badge>
)}
```

---

## Deployment Instructions

### 1. Deploy Updated Edge Function

```bash
cd A:\RE-TOUR
npx supabase functions deploy run-pipeline-step
```

Wait 1-2 minutes for deployment.

### 2. Test Step 2

1. Run Step 2 (Style Reference) in the UI
2. Check Supabase Edge Function logs for `run-pipeline-step`:

**Expected Success Logs**:
```
[QA] Preparing request to run-qa-check Edge Function
[QA] Pipeline: <id>, Project: <id>, Step: 2, Attempt: 1
[QA] Calling run-qa-check: {"upload_id":"...","qa_type":"style",...}
[QA] run-qa-check completed in 2500ms, status: 200
[QA] run-qa-check result: {"qa_decision":"approved","qa_score":85,...}
[QA] Final decision: approved, score: 85, reason: All checks passed
```

**If QA Rejects**:
```
[QA] Final decision: rejected, score: 45, reason: [furniture_mismatch] Single bed changed to double bed; [text_label_missing] Kitchen label missing
```

### 3. Verify Database

Check that QA results are stored:

```sql
SELECT
  pipeline_id,
  step_number,
  attempt_index,
  qa_decision,
  qa_score,
  qa_reason,
  created_at
FROM floorplan_pipeline_step_attempts
WHERE step_number = 2
ORDER BY created_at DESC
LIMIT 5;
```

You should see:
- `qa_decision`: "approved" or "rejected"
- `qa_score`: Number between 0-100 (or null if QA failed)
- `qa_reason`: Specific rejection reasons (not "QA could not run")

### 4. Frontend Updates (Optional)

If you want to apply the QAReviewPanel format to Step 2:

1. Locate the Step 2 output display component
2. Import and use `QAReviewPanel` from `@/components/shared/QAReviewPanel`
3. Pass `initialScore={attempt.qa_score}` to pre-fill the QA score

---

## Troubleshooting

### Still seeing "QA could not run (missing API key)"

**Possible causes**:
1. Old function version still running (wait 2 minutes after deployment)
2. Deployment failed (check `npx supabase functions list` for timestamp)
3. `API_NANOBANANA` environment variable not set (check Supabase Dashboard → Edge Functions → Secrets)

**Fix**:
```bash
# Re-deploy
npx supabase functions deploy run-pipeline-step --debug

# Check deployment status
npx supabase functions list
```

### QA score is null/missing

**Possible causes**:
1. `run-qa-check` is not returning `qa_score` field
2. QA failed before scoring (e.g., invalid images, API error)

**Check**:
- Look at Edge Function logs for `run-qa-check` (not `run-pipeline-step`)
- Verify `qa_score` is in the response JSON

### Rejection reasons still generic

**Possible causes**:
1. `run-qa-check` returned an error (check its logs)
2. Response parsing failed

**Check**:
```sql
SELECT qa_reason, qa_result_full
FROM floorplan_pipeline_step_attempts
WHERE step_number = 2
ORDER BY created_at DESC
LIMIT 1;
```

Look at `qa_result_full` JSON - it should contain structured `reasons` array.

---

## Summary Checklist

- [x] Replace OpenAI QA with Gemini-based `run-qa-check` call
- [x] Extract and store `qa_score` from QA response
- [x] Format rejection reasons with categories
- [x] Pass all required parameters to `run-qa-check`
- [ ] Deploy updated function
- [ ] Test Step 2 and verify logs
- [ ] (Optional) Update frontend to use `QAReviewPanel` for consistent display
- [ ] Verify attempts are visible in UI

---

## Related Files

**Backend**:
- `supabase/functions/run-pipeline-step/index.ts` - Main pipeline execution (QA call site)
- `supabase/functions/run-qa-check/index.ts` - Gemini-based QA service
- `supabase/functions/_shared/qa-judge-persistence.ts` - QA result persistence

**Frontend**:
- `src/components/shared/QAReviewPanel.tsx` - Standard QA score/review component
- `src/components/whole-apartment/QARejectionCard.tsx` - Rejection reason display
- `src/components/whole-apartment/AttemptHistoryGrid.tsx` - Attempt history display

---

## Next Steps

After deployment:
1. Test Step 2 with a known good input
2. Test Step 2 with a known bad input (should reject with specific reasons)
3. Verify QA scores display correctly
4. Check that multiple attempts are visible
5. (Optional) Apply `QAReviewPanel` format to Step 2 for UI consistency
