# 🔐 Secret Verification Checklist

**Method:** Supabase Dashboard (Project Settings → Edge Functions → Secrets)
**Date:** 2026-02-08
**Project:** RE-TOUR Production (`zturojwgqtjrxwsfbwqw`)

---

## ✅ Required Secrets Verification

### Core Supabase Secrets
- [ ] `SUPABASE_URL`
  - **Expected Value:** `https://zturojwgqtjrxwsfbwqw.supabase.co`
  - **Status:** ⬜ Not Verified
  - **Used By:** All Edge Functions (database + storage access)

- [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - **Expected Format:** `eyJ...` (JWT token)
  - **Status:** ⬜ Not Verified
  - **Used By:** All Edge Functions (bypasses RLS for backend operations)

- [ ] `SUPABASE_ANON_KEY`
  - **Expected Format:** `eyJ...` (JWT token)
  - **Status:** ⬜ Not Verified
  - **Used By:** Edge Functions that need RLS-enforced access

---

### LLM API (Google Gemini - EXCLUSIVE)
- [ ] `API_NANOBANANA`
  - **Expected Format:** Google Gemini API key
  - **Status:** ⬜ Not Verified
  - **Used By:** ALL LLM functionality
    - Image generation (gemini-2.0-flash-exp-image-generation)
    - Text analysis (gemini-2.5-pro)
    - Space analysis (run-space-analysis)
    - Prompt composition (compose-pipeline-prompt, optimize-pipeline-prompt)
    - QA evaluation (run-qa-check, run-global-qa, run-logical-qa)
    - Rejection analysis (analyze-rejection)
    - Style analysis (run-style-analysis)

---

### Observability (MANDATORY)
- [ ] `LANGFUSE_ENABLED`
  - **Expected Value:** `"true"`
  - **Status:** ⬜ Not Verified
  - **Used By:** All tracing and observability

- [ ] `LANGFUSE_SECRET_KEY`
  - **Expected Format:** `sk-lf-...`
  - **Status:** ⬜ Not Verified
  - **Used By:** Langfuse client authentication

- [ ] `LANGFUSE_PUBLIC_KEY`
  - **Expected Format:** `pk-lf-...`
  - **Status:** ⬜ Not Verified
  - **Used By:** Langfuse client authentication

- [ ] `LANGFUSE_BASE_URL`
  - **Expected Format:** `https://cloud.langfuse.com` or self-hosted URL
  - **Status:** ⬜ Not Verified
  - **Used By:** Langfuse API endpoint

---

## ❌ Obsolete Secrets (DO NOT SET)

- ❌ `API_OPENAI` - OBSOLETE, not used, do not set
  - **Reason:** System uses Google Gemini exclusively for all LLM tasks
  - **Migration:** All OpenAI functionality replaced by Gemini
  - **Action:** If present, can be ignored or removed

---

## 📋 Verification Steps

1. **Access Supabase Dashboard**
   - Navigate to: https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw
   - Go to: Project Settings → Edge Functions → Secrets

2. **Check Each Secret**
   - Verify presence of all 8 required secrets
   - Confirm values match expected formats
   - Mark checkbox when verified

3. **Confirm Obsolete Secrets**
   - Verify `API_OPENAI` is NOT present (or ignored if legacy)
   - No dependencies on OpenAI in active code paths

4. **Document Results**
   - Update this checklist with verification status
   - Note any missing secrets
   - Document any configuration issues

---

## 🚨 Critical Dependencies

### If Missing: API_NANOBANANA
- **Impact:** ALL pipeline steps will fail (no image generation, no text analysis)
- **Steps 0-7:** Complete pipeline blocked
- **Priority:** CRITICAL - Must be set before any pipeline execution

### If Missing: LANGFUSE_* Keys
- **Impact:** No observability, no trace logging, no prompt management
- **Monitoring:** Blind to pipeline execution details
- **QA Analysis:** Cannot track LLM-as-Judge evaluations
- **Priority:** CRITICAL - Required for production operation

### If Missing: SUPABASE_SERVICE_ROLE_KEY
- **Impact:** Edge Functions cannot write to database (RLS bypass required)
- **Pipeline State:** Cannot update floorplan_pipelines table
- **Priority:** CRITICAL - System will not function

---

## ✅ Post-Verification

Once all secrets are verified:
- [ ] Update this checklist with confirmation
- [ ] Proceed to Reality Validation Gate (Option A: Run full pipeline)
- [ ] Document any issues encountered

---

**Last Updated:** 2026-02-08 16:25 UTC
