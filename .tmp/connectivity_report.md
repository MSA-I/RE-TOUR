# 🔗 Phase 2: Link - Connectivity Report

**Generated:** 2026-02-08 16:10 UTC
**Status:** Environment Analysis Complete

---

## 📋 Required Environment Variables

### Frontend (.env) - Public Keys Only ✅
```bash
VITE_SUPABASE_PROJECT_ID="zturojwgqtjrxwsfbwqw"
VITE_SUPABASE_ANON_KEY="sb_publishable_W7uP2HoitkRKQuKKiTOHTg_XDH3dBET"
VITE_SUPABASE_URL="https://zturojwgqtjrxwsfbwqw.supabase.co"
```

**Status:** ✅ Present and correctly scoped (VITE_* prefix for public use)

---

### Backend (Supabase Secrets) - Private Keys Required

These are stored securely in Supabase Secrets (NOT in .env) and accessed via `Deno.env.get()` in Edge Functions:

#### Supabase Core
```bash
SUPABASE_URL              # Database + Storage + Auth URL
SUPABASE_SERVICE_ROLE_KEY # Backend service key (bypasses RLS)
SUPABASE_ANON_KEY         # Public anon key (RLS-enforced)
```

#### LLM APIs (Google Gemini - EXCLUSIVE)
```bash
API_NANOBANANA            # Google Gemini API key (ALL LLM functionality)
                          # Used for: image generation, text analysis, prompt composition,
                          # QA evaluation, repair loop analysis, style analysis
                          # Models: gemini-2.5-pro, gemini-2.0-flash-exp-image-generation
```

**⚠️ REMOVED:** `API_OPENAI` is OBSOLETE. System uses Gemini exclusively for all LLM tasks.

#### Observability (MANDATORY)
```bash
LANGFUSE_ENABLED          # MUST be "true" (observability required)
LANGFUSE_SECRET_KEY       # Langfuse secret key (sk-lf-...)
LANGFUSE_PUBLIC_KEY       # Langfuse public key (pk-lf-...)
LANGFUSE_BASE_URL         # API base URL (e.g., https://cloud.langfuse.com)
```

**Status:** MANDATORY - Required for tracing, prompt management, and LLM-as-Judge evaluation.

---

## 🔍 Configuration Discovery

### Project ID Mismatch ⚠️
- `.env` has: `zturojwgqtjrxwsfbwqw`
- `supabase/config.toml` has: `pyswjfcqirszxelrsotw`

**Analysis:** This is likely a local vs. remote project configuration.
- `.env` → Production Supabase project (deployed)
- `config.toml` → Local Supabase project for testing

**Recommendation:** Use `.env` values for production connectivity tests.

---

## 🛠️ Edge Functions Status

### Deployment
- **Total Functions:** 59 deployed
- **JWT Verification:** Disabled for all functions (verify_jwt = false)
- **Runtime:** Deno (TypeScript-native)

### Critical Functions (Pipeline Steps)
```
Step 0: run-space-analysis (Floor plan → spatial map)
Step 1: run-pipeline-step (Top-Down 3D generation)
Step 2: run-pipeline-step (Style application)
Step 3: confirm-camera-plan (Camera marker confirmation)
Step 4: run-detect-spaces (Space detection)
Step 5: run-batch-space-renders (A/B render generation)
Step 6: run-batch-space-panoramas (A/B panorama generation)
Step 7: run-batch-space-merges (Final 360 merge)
```

### Support Functions
- **Prompt Management (Gemini):** compose-pipeline-prompt, optimize-pipeline-prompt, compose-final-prompt
- **QA System (Gemini):** run-qa-check, run-global-qa, run-logical-qa, analyze-rejection
- **Camera System:** create-camera-anchor, confirm-camera-plan, run-camera-scan
- **Retry/Recovery:** retry-pipeline-step, run-reject-and-retry, rollback-to-previous-step
- **Storage:** create-signed-upload-url, create-signed-download-url, create-signed-view-url
- **Observability (Mandatory):** langfuse-test

**LLM Provider:** Google Gemini ONLY. No OpenAI integration (legacy references should be ignored).

---

## 🧪 Connectivity Test Plan

### Phase 2 Verification Checklist

#### 1. Supabase Connection ✅
- [ ] Test database connection (read from `floorplan_pipelines`)
- [ ] Test storage access (list buckets: panoramas, design_refs, outputs)
- [ ] Verify RLS policies (user-scoped access)
- [ ] Test Edge Function invocation

#### 2. API Endpoints
- [ ] **Google Gemini** (via API_NANOBANANA) - EXCLUSIVE LLM PROVIDER
  - Test text analysis: `gemini-2.5-pro:generateContent`
  - Test image generation: `gemini-2.0-flash-exp-image-generation:generateContent`
  - Test prompt composition (replaces OpenAI)
- [ ] **Langfuse** (MANDATORY)
  - Test trace creation
  - Verify ingestion endpoint
  - Confirm prompt management access

**⚠️ REMOVED:** OpenAI testing (obsolete, not used)

#### 3. Edge Functions Smoke Test
- [ ] `run-space-analysis` - Test with sample floor plan
- [ ] `continue-pipeline-step` - Test phase transition
- [ ] `langfuse-test` - Verify observability

---

## ⚠️ Known Constraints

### API Rate Limits (from Discovery)
- **Google Gemini:** 60 requests/minute (ALL LLM tasks: generation + analysis + QA)
- **NanoBanana:** 10 concurrent generations (GPU pool limit)
- **Langfuse:** Unlimited traces (cloud or self-hosted)

**⚠️ REMOVED:** OpenAI rate limits (not applicable)

### Storage Limits
- **Supabase Storage:** 100 GB total
- **Image Upload:** Max 10 MB per file

### Security
- **Frontend:** Only VITE_* env vars exposed
- **Backend:** All private keys in Supabase Secrets
- **Storage:** RLS extracts user_id from path: `storage.foldername(name)[1]`

---

## 🚀 Next Steps

### Before Reality Validation Gate
1. ✅ Document all required environment variables
2. ⬜ Verify Supabase Secrets are set (requires Supabase CLI access)
3. ⬜ Run connectivity smoke tests
4. ⬜ **Run at least ONE full real pipeline (Step 0 → Step 7)**
5. ⬜ Document actual failure points and QA friction
6. ⬜ Update gemini.md with real-world learnings

### After Reality Validation
- Proceed to Phase 3 (Architect) with validated patterns
- Build automation tooling based on observed failures
- Implement self-healing loops for real error patterns

---

**Status:** Phase 2 (Link) - Environment analysis complete. Ready for connectivity tests.
