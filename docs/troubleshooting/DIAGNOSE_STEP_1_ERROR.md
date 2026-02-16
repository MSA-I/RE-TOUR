# Quick Diagnosis: Step 1 Error

## The Error You're Seeing

```
hasError: true
errorMessage: 'Edge Function returned a non-2xx status code'
hasData: false
```

This means the `run-pipeline-step` Edge Function returned an HTTP error (4xx or 5xx), but the Supabase client didn't expose the error message.

## Immediate Action: Check Supabase Logs

**This is the ONLY way to see the actual error right now.**

### Step-by-Step:

1. **Open Supabase Dashboard**
   - Go to https://supabase.com/dashboard
   - Select your project

2. **Navigate to Edge Functions**
   - Left sidebar → **Edge Functions**
   - Click on `run-pipeline-step`

3. **View Logs**
   - Click **Logs** tab
   - Look at the most recent log entry (should be within last minute)

4. **Find the Error**

Look for entries like:

**✅ If you see this - it's a phase error:**
```
[RUN_PIPELINE_STEP] Phase mismatch: expected one of [top_down_3d_pending, top_down_3d_running, style_pending, style_running], got "space_analysis_complete"
```
**Fix**: The phase transition didn't happen. See fix below.

**✅ If you see this - it's a missing dependency:**
```
Floor plan not found
```
**Fix**: Re-upload floor plan and run Step 0 again.

**✅ If you see this - it's missing Step 0 output:**
```
Space analysis output not found
```
**Fix**: Re-run Step 0.

**✅ If you see this - it's a memory error (NOW FIXED):**
```
shutdown - Memory limit exceeded - [Memory before-load-input]
```
**Status**: This issue has been fixed via automatic server-side image downscaling for Steps 1-4. Images are now automatically reduced to max 2400px before loading into memory.

If you still see this error after the fix, check that Supabase Storage image transformations are enabled for your bucket. See: `docs/SERVER_SIDE_IMAGE_DOWNSCALING.md`

---

## Quick Fixes

### Fix 1: Phase Mismatch (Most Likely)

If logs show phase mismatch (`space_analysis_complete` instead of `top_down_3d_pending`):

**The `continue-pipeline-step` call either:**
- Failed silently
- Succeeded but frontend state is stale
- Got a race condition

**Solution A: Manual Database Update**

Open browser console (F12) and run:

```javascript
// Get your pipeline ID from the URL (should be visible)
const pipelineId = "<your-pipeline-id>";

// Manually transition to top_down_3d_pending
const { data, error } = await supabase
  .from("floorplan_pipelines")
  .update({ whole_apartment_phase: "top_down_3d_pending" })
  .eq("id", pipelineId)
  .select()
  .single();

if (error) {
  console.error("Update failed:", error);
} else {
  console.log("✓ Phase updated to:", data.whole_apartment_phase);
  alert("Phase fixed! Refresh the page and try Step 1 again.");
}
```

Then:
1. Refresh the page (F5)
2. Click "Run Step 1" again

**Solution B: Check continue-pipeline-step logs**

1. Go to Supabase Dashboard → Edge Functions
2. Click `continue-pipeline-step`
3. Click **Logs**
4. Look for errors like:
   - "Phase mismatch"
   - "Unauthorized"
   - "Pipeline not found"

### Fix 2: Missing Dependencies

If logs show missing floor plan or space analysis:

1. Navigate back to pipeline setup
2. Re-upload floor plan if needed
3. Run Step 0 again
4. Wait for "Space Analysis Complete"
5. Try Step 1 again

### Fix 3: Refresh and Retry

Sometimes it's just a stale state:

1. Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
2. Wait 2-3 seconds
3. Click "Run Step 1" again

---

## Debugging Script

Run this in browser console to get full pipeline state:

```javascript
// Replace with your actual pipeline ID from the URL
const pipelineId = window.location.pathname.split('/').pop();

console.log("Pipeline ID:", pipelineId);

// Fetch current state
const { data: pipeline, error } = await supabase
  .from("floorplan_pipelines")
  .select("*")
  .eq("id", pipelineId)
  .single();

if (error) {
  console.error("Failed to fetch pipeline:", error);
} else {
  console.log("=== PIPELINE STATE ===");
  console.log("Phase:", pipeline.whole_apartment_phase);
  console.log("Current Step:", pipeline.current_step);
  console.log("Status:", pipeline.status);
  console.log("Has floor plan:", !!pipeline.floor_plan_upload_id);
  console.log("Has Step 0 output:", !!pipeline.step_outputs?.space_analysis);
  console.log("Space analysis rooms:", pipeline.step_outputs?.space_analysis?.rooms?.length || 0);

  // Check what phase we should be in
  const expectedPhase = pipeline.current_step === 0 ? "space_analysis_complete" :
                       pipeline.current_step === 1 ? "top_down_3d_pending" : "unknown";

  console.log("Expected phase for step", pipeline.current_step + ":", expectedPhase);

  if (pipeline.whole_apartment_phase !== expectedPhase) {
    console.warn("⚠️  PHASE MISMATCH!");
    console.warn("  Current:", pipeline.whole_apartment_phase);
    console.warn("  Expected:", expectedPhase);
    console.warn("  → Run the manual update script above to fix");
  } else {
    console.log("✓ Phase is correct");
  }
}
```

---

## Most Likely Scenario

Based on your error, the most likely scenario is:

**The `continue-pipeline-step` call succeeded, but the phase transition didn't complete in time.**

This can happen if:
- Database transaction took too long
- Race condition between frontend and backend
- Frontend cache is stale

**Quick fix**: Run the manual database update script above, then refresh and retry.

---

## If Nothing Works

1. **Copy the Supabase logs** (both `continue-pipeline-step` and `run-pipeline-step`)
2. **Copy the pipeline state** (from debugging script above)
3. **Copy the browser console logs** (everything with `[TOP_DOWN_3D_START]`)
4. Share all of the above

The combination of these three logs will definitively show what's wrong.
