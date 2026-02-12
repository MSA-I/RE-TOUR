# Debug: Why Are Suggestions Still Generic?

## Problem
User reports suggestions are still generic/repetitive despite Gemini AI being implemented and API key being set.

## Status Check

✅ **GEMINI_API_KEY is set** in Supabase secrets
✅ **save-camera-intents function deployed** (ACTIVE)
✅ **Gemini AI code exists** in save-camera-intents/index.ts (lines 28-145)

## Investigation Steps

### Step 1: Check if suggestions were regenerated

The existing suggestions in the database might be OLD (from before Gemini was set up).

**SQL to check**:
```sql
-- Check when suggestions were created
SELECT
  pipeline_id,
  COUNT(*) as suggestion_count,
  MAX(created_at) as latest_suggestion,
  MIN(created_at) as oldest_suggestion
FROM camera_intents
GROUP BY pipeline_id
ORDER BY latest_suggestion DESC;
```

**If suggestions are old** (created before Gemini API key was set):
- They need to be DELETED and REGENERATED
- Old suggestions won't magically become AI-powered

### Step 2: Force regeneration

Delete existing suggestions for your test pipeline:

```sql
-- Find your pipeline ID first
SELECT id, created_at FROM floorplan_pipelines
WHERE user_id = auth.uid()
ORDER BY created_at DESC LIMIT 5;

-- Delete suggestions for specific pipeline
DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID_HERE';
```

Then reopen the Camera Intent dialog - it should auto-regenerate with AI.

### Step 3: Check edge function logs

View logs in Supabase Dashboard:
1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/logs/edge-functions
2. Filter by: `save-camera-intents`
3. Look for recent invocations

**What to look for**:

**If using AI (GOOD)**:
```
[save-camera-intents] Generating AI suggestions for 5 spaces
[save-camera-intents] Generating for: Living Room (living_room)
[save-camera-intents] Successfully generated 18 AI-powered suggestions
```

**If using fallback (BAD)**:
```
[save-camera-intents] GEMINI_API_KEY not set - using fallback templates
```

**If Gemini API failing**:
```
[save-camera-intents] AI generation failed: <error message>
[save-camera-intents] Using fallback suggestions
```

### Step 4: Check browser console

Open DevTools (F12) when clicking "Define Camera Intent":

**Look for API response**:
```json
{
  "success": true,
  "count": 18,
  "ai_powered": true,  // ← Should be true
  "ai_model": "gemini-1.5-flash",
  "spaces_processed": 5
}
```

If `ai_powered: false`, the function is using fallback mode despite API key being set.

### Step 5: Test Gemini API key validity

Test if the API key actually works:

```bash
# Test Gemini API directly
curl -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{
        "text": "Say hello"
      }]
    }]
  }'
```

Expected response:
```json
{
  "candidates": [{
    "content": {
      "parts": [{"text": "Hello!"}]
    }
  }]
}
```

If error:
```json
{
  "error": {
    "code": 400,
    "message": "API key not valid"
  }
}
```

Then the API key is invalid or expired.

## Common Issues

### Issue 1: Old suggestions not regenerated

**Symptom**: Suggestions created before Gemini setup
**Fix**: Delete and regenerate

### Issue 2: Step 2 image missing

**Symptom**: Error "Step 2 (Style) must be completed first"
**Fix**: Complete Step 2 before generating suggestions

```sql
-- Check if Step 2 output exists
SELECT
  id,
  step_outputs->'step2'->'output_upload_id' as step2_image,
  step_outputs->'space_analysis' as space_analysis
FROM floorplan_pipelines
WHERE id = 'YOUR_PIPELINE_ID';
```

Should return a UUID for `step2_image`, not null.

### Issue 3: Gemini API rate limit

**Symptom**: Error 429 "Resource exhausted"
**Fix**: Wait 1 minute and retry (free tier = 15 requests/minute)

### Issue 4: Invalid API key format

**Symptom**: Error 400 from Gemini API
**Fix**:
1. Get new key from https://aistudio.google.com/app/apikey
2. Ensure it starts with `AIzaSy...`
3. Reset in Supabase: `supabase secrets set GEMINI_API_KEY=AIzaSy...`

### Issue 5: Function cached in browser

**Symptom**: Changes not taking effect
**Fix**: Hard refresh browser (Ctrl+Shift+R)

## Next Steps

1. **Check suggestion age** - Are they old (before Gemini setup)?
2. **Delete old suggestions** - Force regeneration
3. **Check edge function logs** - Is AI actually running?
4. **Check browser console** - Is `ai_powered: true`?
5. **Test API key directly** - Is it valid?

## What User Should Do Right Now

```sql
-- 1. Find your active pipeline
SELECT id, created_at, whole_apartment_phase
FROM floorplan_pipelines
WHERE user_id = auth.uid()
ORDER BY created_at DESC
LIMIT 5;

-- 2. Check existing suggestions for that pipeline
SELECT
  ci.created_at,
  s.name as space_name,
  ci.suggestion_text
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id
WHERE ci.pipeline_id = 'PASTE_PIPELINE_ID_HERE'
ORDER BY s.name, ci.suggestion_index;

-- 3. If suggestions look generic, DELETE THEM
DELETE FROM camera_intents WHERE pipeline_id = 'PASTE_PIPELINE_ID_HERE';

-- 4. Reopen Camera Intent dialog in UI - should regenerate with AI
```

Then verify:
- Loading takes 10-25 seconds (AI generation)
- Toast shows "Suggestions Generated"
- Suggestions are unique and contextual
- Console shows `ai_powered: true`
