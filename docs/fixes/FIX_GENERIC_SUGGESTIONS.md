# Fix: Generic Suggestions Despite Gemini API Being Set

## The Problem

The `save-camera-intents` function is **failing silently** and falling back to generic templates instead of using Gemini AI.

**Evidence**:
- ✅ GEMINI_API_KEY is set in Supabase
- ✅ save-camera-intents function is deployed
- ✅ Gemini AI code exists in the function
- ❌ But suggestions are still generic

**Root Cause**: The Gemini API call is throwing an error (line 141-143 in index.ts), and the function catches it and returns fallback templates instead.

## Quick Diagnosis (3 Steps)

### Step 1: Check if suggestions are actually AI-generated

Run this in **Supabase SQL Editor**:

```sql
-- Check the latest pipeline's suggestions
WITH latest_pipeline AS (
  SELECT id FROM floorplan_pipelines ORDER BY created_at DESC LIMIT 1
)
SELECT
  s.name as space_name,
  ci.suggestion_text,
  LENGTH(ci.suggestion_text) as length,
  ci.created_at
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id
WHERE ci.pipeline_id = (SELECT id FROM latest_pipeline)
ORDER BY s.name, ci.suggestion_index;
```

**If you see**:
- ❌ "Wide shot capturing the entire Living Room layout and natural light flow"
- ❌ "Detail view focusing on key architectural features..."

→ These are **FALLBACK TEMPLATES** (lines 154-164 of function)

**AI-generated suggestions look like**:
- ✅ "Wide shot from entry doorway capturing the bay window seating area with natural morning light streaming across the hardwood floors"
- ✅ Long, detailed, specific to the actual room features

### Step 2: Test Gemini API Key

The API key might be set but **invalid** or **not enabled for Gemini**.

Run this test:

```bash
cd A:\RE-TOUR\Troubleshooting_Agent

# Get your API key from Supabase
# Then run test (requires Deno)
set GEMINI_API_KEY=YOUR_KEY_HERE
deno run --allow-net --allow-env test_gemini_api.ts
```

**OR** test directly with curl:

```bash
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d "{\"contents\":[{\"parts\":[{\"text\":\"Say hello\"}]}]}"
```

**Expected**: `{"candidates":[{"content":{"parts":[{"text":"Hello!"}]}}]}`

**If Error 400**: API key is invalid or not enabled
**If Error 403**: API key doesn't have Gemini API access

### Step 3: Check Edge Function Logs

The real error is being logged but you can't see it without checking logs.

**In Supabase Dashboard**:
1. Go to: **Logs** → **Edge Functions**
2. Filter by: `save-camera-intents`
3. Look for: `[save-camera-intents] AI generation failed`
4. Read the actual error message

**Common errors**:

| Error | Cause | Fix |
|-------|-------|-----|
| `Failed to fetch image: 403` | Step 2 image signed URL expired | Regenerate Step 2 |
| `Gemini API error: 400` | Invalid API key | Get new key |
| `Gemini API error: 403` | API not enabled | Enable in Google Cloud |
| `Gemini API error: 429` | Rate limit | Wait 1 minute |
| `Failed to fetch image: 404` | Step 2 output missing | Complete Step 2 |

## Common Issues & Fixes

### Issue 1: API Key Not Enabled for Gemini

**Symptom**: Error 403 or 400 from Gemini API

**Fix**:
1. Go to: https://aistudio.google.com/app/apikey
2. Create a **NEW** API key (not just copy existing)
3. The key creation process automatically enables Gemini API
4. Set in Supabase: `supabase secrets set GEMINI_API_KEY=AIzaSy...`
5. Redeploy function: `supabase functions deploy save-camera-intents`

### Issue 2: Step 2 Image Missing or Expired

**Symptom**: Error "Failed to fetch image"

**Check**:
```sql
SELECT
  id,
  step_outputs->'step2'->'output_upload_id' as step2_image
FROM floorplan_pipelines
WHERE id = 'YOUR_PIPELINE_ID';
```

**Fix**:
- If `step2_image` is null: Complete Step 2 first
- If `step2_image` exists but fetch fails: Image might be deleted, redo Step 2

### Issue 3: Old Suggestions Not Regenerated

**Symptom**: Suggestions were created before Gemini was set up

**Fix**:
```sql
-- Delete ALL suggestions for your pipeline
DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';

-- Reopen Camera Intent dialog - will auto-regenerate
```

### Issue 4: Image Too Large

**Symptom**: Gemini API rejects large images

**Fix**: Step 2 images should be optimized/compressed before storage

## Debugging Workflow

```
1. Run diagnostic SQL (Step 1 above)
   ↓
   Are suggestions generic/short?
   ↓
2. Test Gemini API key (Step 2 above)
   ↓
   Does API respond?
   ↓
3. Check edge function logs (Step 3 above)
   ↓
   What's the actual error?
   ↓
4. Fix the specific error
   ↓
5. Delete old suggestions
   ↓
6. Regenerate and verify
```

## Verify AI is Working

After fixing:

1. **Delete old suggestions**:
   ```sql
   DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';
   ```

2. **Open Camera Intent dialog**
   - Should take 10-25 seconds (AI generation)
   - Toast: "Suggestions Generated"

3. **Check browser console** (F12):
   ```json
   {
     "success": true,
     "ai_powered": true,  // ← Must be true!
     "ai_model": "gemini-1.5-flash",
     "count": 18
   }
   ```

4. **Verify suggestions are detailed**:
   - Should be >100 characters
   - Should mention specific room features
   - Should be unique per space

## What to Send Me for Help

If still not working, send me:

1. **Output from diagnostic SQL** (Step 1)
2. **One example of a "generic" suggestion** you're seeing
3. **Edge function logs** showing the error
4. **Result from testing Gemini API** (Step 2)

Then I can identify the exact issue blocking AI generation.

## Quick Fix Script

Run all at once:

```sql
-- 1. Find your pipeline ID
SELECT id, created_at FROM floorplan_pipelines
ORDER BY created_at DESC LIMIT 5;

-- 2. Delete old suggestions (paste pipeline ID)
DELETE FROM camera_intents WHERE pipeline_id = 'PASTE_ID_HERE';

-- 3. Verify deletion
SELECT COUNT(*) FROM camera_intents WHERE pipeline_id = 'PASTE_ID_HERE';
-- Should return 0

-- 4. Now reopen Camera Intent dialog in UI
-- Should regenerate with AI (if API key is valid)
```
