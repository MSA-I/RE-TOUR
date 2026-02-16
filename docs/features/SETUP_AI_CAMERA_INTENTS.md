# Setup AI-Powered Camera Intent Suggestions

## What Changed

The `save-camera-intents` edge function now uses **Claude 3.5 Sonnet with vision** to generate contextual, unique camera intent suggestions by:

1. ✅ Analyzing the **Step 2 styled top-down image** (the rendered floor plan)
2. ✅ Reading **space analysis data** (detected furniture, room characteristics)
3. ✅ Using **AI vision** to generate specific suggestions per space
4. ✅ Contextual output like:
   - "Wide shot from entry doorway capturing the entire room flow and natural light from the bay windows"
   - "Detail view of the built-in bookshelf and reading nook with architectural details"

**BEFORE:** Generic templates → "Standard wide view for Bedroom #2"
**AFTER:** AI-generated context → "Wide shot capturing bay window seating area and natural morning light in Bedroom #2"

---

## Setup Instructions

### Step 1: Get Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to **API Keys** section
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-...`)

### Step 2: Add API Key to Supabase

#### **Option A: Supabase Dashboard (Recommended)**

1. Open https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/settings/functions
2. Click **Edge Functions** → **Manage secrets**
3. Add new secret:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: Your API key (e.g., `sk-ant-api03-...`)
4. Click **Save**

#### **Option B: Supabase CLI**

```bash
cd A:\RE-TOUR
supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-YOUR-KEY-HERE
```

### Step 3: Regenerate Suggestions

1. **Delete existing suggestions** (run in Supabase SQL Editor):
```sql
DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';
```

2. **Reopen the Camera Intent dialog** - It will auto-detect empty suggestions and regenerate using AI

---

## How It Works

### AI Vision Analysis

When you click "Define Camera Intent", the function:

1. **Fetches the Step 2 styled image** (the top-down rendered floor plan)
2. **Fetches space analysis data** (detected furniture, dimensions, room type)
3. **Calls Claude 3.5 Sonnet with vision** for each space:
   ```
   Input:
   - Styled floor plan image (base64)
   - Space name: "Living Room"
   - Space type: "living_room"
   - Detected items: "2x sofa, 1x coffee table, 1x TV stand"
   - Dimensions: "4.2m × 3.8m"

   Output:
   - Wide shot from entry doorway capturing the entire room flow and natural light from the bay windows
   - Detail view of the built-in bookshelf and reading nook with architectural details
   - Diagonal angle from corner showcasing the open kitchen-living connection and island
   - Close-up of fireplace feature wall highlighting the custom tilework and mantel
   ```

4. **Stores unique suggestions** in `camera_intents` table

### Fallback Mode

If `ANTHROPIC_API_KEY` is not set, the function automatically falls back to **improved template suggestions**:
- Still better than before (more descriptive)
- No AI costs
- Instant generation

Example fallback:
- "Wide shot capturing the entire Living Room layout and natural light flow"
- "Detail view focusing on key architectural features and design elements in Living Room"

---

## Cost Estimate

**Claude 3.5 Sonnet Pricing:**
- **Input**: $3 per million tokens (~$0.003 per 1K tokens)
- **Output**: $15 per million tokens (~$0.015 per 1K tokens)

**Per Pipeline Estimate:**
- 5 spaces × 1 image analysis each = 5 API calls
- ~2K input tokens per call (image + prompt) = 10K tokens total = **$0.03**
- ~200 output tokens per call = 1K tokens total = **$0.015**
- **Total cost per pipeline: ~$0.05 (5 cents)**

For 100 pipelines/month: **~$5/month**

---

## Testing

### Test with AI (ANTHROPIC_API_KEY set)

1. Delete existing suggestions (see SQL above)
2. Click "Define Camera Intent"
3. **Expected**:
   - Loading takes 5-15 seconds (AI generation)
   - Toast: "Suggestions Generated"
   - Each space shows **unique, contextual** suggestions
   - Suggestions reference actual features visible in the floor plan

### Test without AI (No API key)

1. Don't set `ANTHROPIC_API_KEY`
2. Click "Define Camera Intent"
3. **Expected**:
   - Loading takes <1 second (template generation)
   - Toast: "Suggestions Generated"
   - Each space shows **improved template** suggestions
   - Suggestions are descriptive but generic

---

## Troubleshooting

### Error: "Step 2 (Style) must be completed first"

**Cause**: Pipeline doesn't have a styled image from Step 2
**Fix**: Complete Step 2 before opening Camera Intent dialog

### Error: "Claude API error: 401"

**Cause**: Invalid or missing `ANTHROPIC_API_KEY`
**Fix**: Check API key is correctly set in Supabase secrets

### Error: "Failed to fetch image: 403"

**Cause**: Signed URL expired or storage permissions issue
**Fix**:
1. Check storage bucket policies
2. Verify uploads table has correct bucket/path
3. Restart edge function

### Suggestions are still generic

**Cause**: Function is using fallback mode (no AI key)
**Fix**: Set `ANTHROPIC_API_KEY` and regenerate suggestions

---

## Code Changes

### New Dependencies
- Anthropic API (Claude 3.5 Sonnet with vision)
- Image fetching and base64 encoding
- Space analysis data parsing

### New Features
1. **Vision analysis**: Reads styled floor plan image
2. **Context awareness**: Uses space analysis data (furniture, dimensions)
3. **Prompt engineering**: Specialized prompt for real estate photography
4. **Fallback mode**: Works without AI key (improved templates)
5. **Error handling**: Graceful degradation on API failures

### Files Modified
- `supabase/functions/save-camera-intents/index.ts` (completely rewritten)

---

## Next Steps

### Immediate
1. [ ] Set `ANTHROPIC_API_KEY` in Supabase
2. [ ] Delete existing suggestions via SQL
3. [ ] Test AI generation with new pipeline
4. [ ] Verify suggestions are unique and contextual

### Future Enhancements
1. **Batch processing**: Generate all spaces in one API call (reduce costs)
2. **Caching**: Cache suggestions to avoid regeneration
3. **Template library**: Save successful suggestions as templates
4. **User feedback**: "Regenerate" button for individual spaces
5. **Multi-image analysis**: Include Step 0 floor plan + Step 2 styled image

---

## API Key Security

⚠️ **IMPORTANT**: Never commit API keys to git!

- ✅ Store in Supabase secrets (encrypted)
- ✅ Access via environment variables only
- ❌ Don't hardcode in code
- ❌ Don't commit to `.env` files

The function safely accesses the key via `Deno.env.get("ANTHROPIC_API_KEY")`.

---

## Success Criteria

After setup, verify:

- [ ] API key is set in Supabase
- [ ] Old suggestions deleted
- [ ] New AI suggestions generated
- [ ] Each space has unique, contextual suggestions
- [ ] Suggestions reference actual floor plan features
- [ ] No "Standard wide view" generic templates
- [ ] Toast shows "Suggestions Generated"
- [ ] Console logs show "AI-powered: true"

---

## Support

If you encounter issues:
1. Check Supabase Edge Function logs
2. Check browser console for errors
3. Verify API key is valid at https://console.anthropic.com/
4. Test with fallback mode (remove API key temporarily)
