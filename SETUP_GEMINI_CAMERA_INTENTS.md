# Setup Gemini AI-Powered Camera Intent Suggestions

## What Changed

The `save-camera-intents` edge function now uses **Google Gemini 1.5 Flash with vision** to generate contextual, unique camera intent suggestions by:

1. ✅ Analyzing the **Step 2 styled top-down image** (the rendered floor plan)
2. ✅ Reading **space analysis data** (detected furniture, room characteristics)
3. ✅ Using **Gemini AI vision** to generate specific suggestions per space
4. ✅ Contextual output like:
   - "Wide shot from entry doorway capturing the entire room flow and natural light from the bay windows"
   - "Detail view of the built-in bookshelf and reading nook with architectural details"

**BEFORE:** Generic templates → "Standard wide view for Bedroom #2"
**AFTER:** AI-generated context → "Wide shot capturing bay window seating area and natural morning light in Bedroom #2"

---

## Quick Setup (3 Steps)

### Step 1: Get Gemini API Key (FREE - 1500 requests/day!)

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with Google account
3. Click **"Get API key"** → **"Create API key"**
4. Copy the key (starts with `AIzaSy...`)

**Pricing:**
- **Gemini 1.5 Flash**: FREE for first 15 requests/minute
- **Free tier**: 1500 requests per day
- **Paid**: $0.075 per million tokens (after free tier)
- **For this app**: ~5 API calls per pipeline = **FREE for most usage!**

### Step 2: Add API Key to Supabase

**Option A: Supabase Dashboard (Recommended)**

1. Open your Supabase project settings → Edge Functions
2. Click **"Edge Functions"** → **"Manage secrets"**
3. Add new secret:
   - **Name**: `GEMINI_API_KEY`
   - **Value**: Your API key (e.g., `AIzaSyA...`)
4. Click **"Save"**

**Option B: Supabase CLI**

```bash
cd A:\RE-TOUR
supabase secrets set GEMINI_API_KEY=AIzaSyA_YOUR-KEY-HERE
```

### Step 3: Test It!

1. **Delete existing suggestions** (run in Supabase SQL Editor):
```sql
DELETE FROM camera_intents WHERE pipeline_id = 'YOUR_PIPELINE_ID';
```

2. **Click "Define Camera Intent"** - AI will auto-generate unique suggestions!

---

## How It Works

### AI Vision Analysis Flow

```
User clicks "Define Camera Intent"
  ↓
Frontend calls save-camera-intents edge function
  ↓
Function fetches Step 2 styled image from storage
  ↓
Function fetches space analysis data (furniture, dimensions)
  ↓
FOR EACH SPACE:
  ├─ Fetch image as base64
  ├─ Build context prompt with space details
  ├─ Call Gemini API with image + prompt
  ├─ Parse AI response into suggestions
  └─ Store in camera_intents table
  ↓
Return success + suggestions count
  ↓
Frontend displays AI-generated checkboxes
```

---

## Cost & Performance

### Gemini 1.5 Flash Pricing

| Usage | Cost |
|-------|------|
| **Free tier** | 1500 requests/day (15 RPM) |
| **Input tokens** | $0.075 per 1M tokens (~$0.00008 per request) |
| **Output tokens** | $0.30 per 1M tokens (~$0.0003 per request) |

### Per Pipeline Cost

- **5 spaces** × 1 AI call each = 5 API calls
- **~1K input tokens** per call (image + prompt) = 5K tokens total = **$0.0004**
- **~150 output tokens** per call = 750 tokens total = **$0.0002**
- **Total cost per pipeline: ~$0.0006 (0.06 cents!)**

**For 100 pipelines/month: ~$0.06/month** (basically free!)

### Performance

- **Generation time**: 2-5 seconds per space
- **Parallel processing**: Sequential (to avoid rate limits)
- **Total time for 5 spaces**: ~10-25 seconds
- **Fallback mode**: <1 second (when API key not set)

---

## Troubleshooting

### Error: "Step 2 (Style) must be completed first"

**Cause**: Pipeline doesn't have a styled image from Step 2
**Fix**: Complete Step 2 before opening Camera Intent dialog

### Error: "Gemini API error: 400"

**Cause**: Invalid API key or malformed request
**Fix**:
1. Verify API key at https://aistudio.google.com/app/apikey
2. Check key starts with `AIzaSy...`
3. Redeploy function: `supabase functions deploy save-camera-intents`

### Error: "Gemini API error: 429 - Resource exhausted"

**Cause**: Rate limit exceeded (15 requests/minute free tier)
**Fix**:
1. Wait 1 minute and retry
2. Upgrade to paid tier for higher limits
3. Or use fallback mode (remove API key)

### Suggestions Still Generic

**Cause**: Function is using fallback mode (no AI key set)
**Fix**:
1. Verify `GEMINI_API_KEY` is set in Supabase secrets
2. Check spelling: `GEMINI_API_KEY` (not `GOOGLE_API_KEY`)
3. Delete existing suggestions and regenerate

---

## Security

### API Key Best Practices

✅ **DO:**
- Store in Supabase secrets (encrypted at rest)
- Access via environment variables only
- Use free tier for development
- Monitor usage at https://aistudio.google.com/app/apikey

❌ **DON'T:**
- Hardcode in code
- Commit to git
- Share publicly
- Use in client-side code

---

## Next Steps

1. [ ] Get Gemini API key from https://aistudio.google.com/app/apikey
2. [ ] Set `GEMINI_API_KEY` in Supabase secrets
3. [ ] Delete existing suggestions via SQL
4. [ ] Test AI generation with your pipeline
5. [ ] Verify suggestions are unique and contextual

---

## API Documentation

- **Gemini API Docs**: https://ai.google.dev/api/rest
- **Get API Key**: https://aistudio.google.com/app/apikey
- **Pricing**: https://ai.google.dev/pricing
- **Rate Limits**: https://ai.google.dev/gemini-api/docs/quota

---

**Enjoy your AI-powered camera intent suggestions! 🚀📷**
