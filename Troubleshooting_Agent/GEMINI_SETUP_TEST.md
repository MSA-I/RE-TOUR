# Gemini AI Camera Intent Testing Guide

## Step 1: Get Gemini API Key

### Option A: Get FREE API Key (Recommended for Testing)

1. Open: **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **"Get API key"** button
4. Click **"Create API key"**
5. Copy the key (starts with `AIzaSy...`)

**Pricing**:
- ✅ FREE tier: 1500 requests/day (15 per minute)
- ✅ Perfect for testing and development
- ✅ Only ~5 API calls per pipeline

### Option B: Test Without API Key (Fallback Mode)

If you want to test immediately without getting an API key:
- Function will use improved template-based suggestions
- Still better than original generic templates
- Good for verifying basic functionality

---

## Step 2: Set API Key in Supabase

### Using Supabase Dashboard

1. Open your Supabase project: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/settings/functions
2. Navigate to **Settings** → **Edge Functions**
3. Click **"Manage secrets"** button
4. Click **"Add new secret"**
5. Enter:
   - **Name**: `GEMINI_API_KEY`
   - **Value**: `AIzaSy...` (your API key)
6. Click **"Save"**

### Using Supabase CLI (Alternative)

```bash
cd A:\RE-TOUR
supabase secrets set GEMINI_API_KEY=AIzaSyA_YOUR_KEY_HERE
```

---

## Step 3: Verify Edge Function Deployment

Check that save-camera-intents is deployed:

```bash
cd A:\RE-TOUR
supabase functions list
```

Expected output should include:
```
save-camera-intents | deployed | 2026-02-12 ...
```

If not deployed:
```bash
supabase functions deploy save-camera-intents
```

---

## Step 4: Delete Existing Suggestions

To test fresh AI generation, delete any existing suggestions.

### Find Your Pipeline ID

1. Open dev server: http://localhost:5173
2. Navigate to your test pipeline
3. Copy pipeline ID from URL: `...?pipelineId=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`

### Delete Suggestions in Supabase SQL Editor

1. Open: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/editor
2. Click **"SQL Editor"**
3. Paste and run:

```sql
-- Replace YOUR_PIPELINE_ID with actual ID
DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';

-- Verify deletion
SELECT COUNT(*) FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';
-- Should return: 0
```

---

## Step 5: Test AI Generation

### Start Dev Server

```bash
cd A:\RE-TOUR
npm run dev
```

Open: http://localhost:5173

### Test Flow

1. **Navigate to Step 3** (Camera Intent)
   - If at earlier step, click through Steps 0→1→2→3
   - Ensure Step 2 (Style) is complete with styled image

2. **Click "Define Camera Intent"** button
   - Dialog should open
   - Wait 10-25 seconds (AI generation in progress)
   - Toast should appear: "Suggestions Generated"

3. **Verify AI Suggestions**
   - ✅ Each space should show 2-4 suggestions
   - ✅ Suggestions should be UNIQUE per space
   - ✅ Should reference actual room features
   - ✅ Should NOT be generic ("Standard wide view")

### Expected Behavior with API Key

**Before (Generic Templates)**:
- "Standard wide view for Bedroom #2"
- "Detail view capturing key features in Bedroom #2"

**After (AI-Powered)**:
- "Wide shot from doorway capturing the bed placement against the window with natural light streaming in from the east-facing windows"
- "Detail view focusing on the cozy reading nook by the bay window with built-in window seat"

---

## Step 6: Verify in Browser Console

Open Developer Tools (F12) and check console logs:

### With API Key (AI Mode)

```
[save-camera-intents] Starting generation for pipeline abc123...
[save-camera-intents] Using styled image: def456
[save-camera-intents] Generating AI suggestions for 5 spaces
[save-camera-intents] Generating for: Living Room (living_room)
[save-camera-intents] Generating for: Bedroom #1 (bedroom)
...
[save-camera-intents] Successfully generated 18 AI-powered suggestions
```

Response should include:
```json
{
  "success": true,
  "count": 18,
  "ai_powered": true,
  "ai_model": "gemini-1.5-flash",
  "spaces_processed": 5
}
```

### Without API Key (Fallback Mode)

```
[save-camera-intents] GEMINI_API_KEY not set - using fallback templates
```

Response should include:
```json
{
  "success": true,
  "count": 12,
  "ai_powered": false,
  "ai_model": "gemini-1.5-flash",
  "spaces_processed": 5
}
```

---

## Step 7: Verify in Database

Check Supabase SQL Editor:

```sql
-- View generated suggestions
SELECT
  s.name AS space_name,
  ci.suggestion_text,
  ci.suggestion_index,
  ci.space_size_category,
  ci.created_at
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id
WHERE ci.pipeline_id = 'YOUR_PIPELINE_ID'
ORDER BY s.name, ci.suggestion_index;
```

**Verify**:
- ✅ Large spaces (Living Room, Kitchen) have 4 suggestions each
- ✅ Normal spaces (Bedroom, Bathroom) have 2 suggestions each
- ✅ Suggestions are unique (no duplicates)
- ✅ `created_at` timestamp is recent

---

## Troubleshooting

### Error: "Step 2 (Style) must be completed first"

**Cause**: Pipeline doesn't have a styled image from Step 2

**Fix**:
1. Go back to Step 2
2. Ensure Step 2 has output image
3. Check `step_outputs` in database:
   ```sql
   SELECT step_outputs->'step2'->'output_upload_id'
   FROM floorplan_pipelines
   WHERE id = 'YOUR_PIPELINE_ID';
   ```
4. Should return a UUID, not null

### Error: "Failed to send a request to the Edge Function"

**Cause**: Edge function not deployed

**Fix**:
```bash
cd A:\RE-TOUR
supabase functions deploy save-camera-intents
```

### Error: "Gemini API error: 400"

**Cause**: Invalid API key

**Fix**:
1. Verify key at https://aistudio.google.com/app/apikey
2. Check key starts with `AIzaSy...`
3. Re-enter in Supabase secrets (no extra spaces)
4. Restart edge function (redeploy if needed)

### Error: "Gemini API error: 429 - Resource exhausted"

**Cause**: Rate limit exceeded (15 requests/minute)

**Fix**:
1. Wait 1 minute and retry
2. Or test with fallback mode (remove API key temporarily)

### Suggestions Still Generic

**Cause**: Function is using fallback mode

**Fix**:
1. Verify `GEMINI_API_KEY` is set:
   ```bash
   supabase secrets list
   ```
2. Check spelling: Must be `GEMINI_API_KEY` exactly
3. Delete suggestions and regenerate
4. Check edge function logs for errors

### Loading Takes Too Long

**Expected**: 10-25 seconds for 5 spaces (2-5 seconds per space)

If taking longer:
1. Check Supabase edge function logs for errors
2. Verify internet connection
3. Check Gemini API status: https://status.google.com/

---

## Success Criteria

After testing, verify:

- [x] Edge function deployed successfully
- [ ] `GEMINI_API_KEY` set in Supabase secrets
- [ ] Old suggestions deleted via SQL
- [ ] New AI suggestions generated (10-25 second wait)
- [ ] Each space has **unique, contextual** suggestions
- [ ] Suggestions reference actual floor plan features
- [ ] NO generic "Standard wide view" templates
- [ ] Toast shows "Suggestions Generated"
- [ ] Console logs show `ai_powered: true, ai_model: "gemini-1.5-flash"`
- [ ] Database shows recent suggestions with correct counts

---

## What to Test

### Test Scenarios

1. **Normal Flow** (with API key)
   - Generate suggestions for new pipeline
   - Verify AI analyzes actual floor plan
   - Verify suggestions are contextual

2. **Fallback Mode** (without API key)
   - Remove GEMINI_API_KEY temporarily
   - Generate suggestions
   - Verify improved templates work
   - Verify no errors

3. **Regeneration** (delete and regenerate)
   - Delete suggestions for same pipeline
   - Regenerate
   - Verify new suggestions are different (AI variation)

4. **Multiple Spaces** (different room types)
   - Verify Living Room gets 4 suggestions
   - Verify Bedroom gets 2 suggestions
   - Verify suggestions match room type

---

## Next Steps After Testing

Once AI suggestions are working:

1. **Proceed to Phase 4**: Manual UI testing
2. **Proceed to Phase 5**: Production deployment
3. **Set production API key**: In production Supabase
4. **Monitor usage**: Check https://aistudio.google.com/app/apikey for quota

---

## Questions to Answer During Testing

- [ ] Do suggestions reference actual room features visible in floor plan?
- [ ] Are suggestions unique per space?
- [ ] Do suggestions make sense for real estate photography?
- [ ] Is generation time acceptable (10-25 seconds)?
- [ ] Does fallback mode work when API key is removed?
- [ ] Do large spaces get 4 suggestions?
- [ ] Do normal spaces get 2 suggestions?

---

**Ready to test! Let me know what you see.** 🚀
