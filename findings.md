# 🔍 Findings & Research

**Project:** RE-TOUR
**Created:** 2026-02-08

---

## 🧩 Project Discovery

### Existing Infrastructure
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Backend:** Supabase (database + auth)
- **Environment:** .env file present
- **Package Manager:** npm (package-lock.json present), bun.lockb also exists

### Directory Structure
```
├── src/              # Frontend source
├── supabase/         # Backend configuration
├── docs/             # Documentation
├── public/           # Static assets
├── .env             # Environment variables
└── node_modules/    # Dependencies
```

---

## 🔬 Technical Constraints

### Discovered During Analysis
- Project is a web application (not pure automation)
- May need to integrate automation tools alongside existing UI

---

## 📚 External Resources

### Production Patterns Research
1. **Image Generation Pipelines**
   - Hugging Face Diffusers (modular architecture)
   - ControlNet for architectural control
   - Multi-stage processing: Sketch → Semantic → Diffusion → Enhancement → Validation

2. **Self-Healing Systems**
   - Circuit Breaker Pattern (3-state: Closed/Open/Half-Open)
   - Exponential Backoff with Jitter (1s, 2s, 4s, 8s, 16s max)
   - Dead Letter Queue for failed items
   - Idempotency keys for duplicate prevention

3. **LLM-as-Judge Frameworks**
   - DeepEval (13.6k stars) - comprehensive evaluation metrics
   - OpenAI Evals (17.7k stars) - systematic benchmarking
   - Quality criteria: Architectural correctness (40%), Prompt alignment (35%), Visual quality (25%)

4. **State Management**
   - XState (29.2k stars) - actor-based state machines
   - Event Sourcing pattern for full audit trails
   - Temporal workflows for durable execution

5. **Supabase Edge Functions**
   - Deno-based serverless (TypeScript native)
   - HMAC signature verification for webhooks
   - Fast cold starts, deny-by-default security

---

## ⚠️ Known Issues

### Architecture Observations
1. **Step 3/4 Swap**: Camera planning moved to Step 3, Space detection to Step 4 (documented in pipeline-action-contract.ts)
2. **Manual QA Gates**: All image-generating steps require manual approval before continuing
3. **No Auto-Continue**: System halts at review phases to prevent runaway generation
4. **State Integrity**: Auto-correction triggers enforce phase-step consistency

### Existing Safeguards
- Phase-step consistency enforced via database trigger
- State recovery with validation (steps 1-2 must be approved)
- Realtime updates via WebSocket subscriptions
- Row Level Security on all tables

---

## 💡 Insights

### System Architecture
1. **Supabase is Single Source of Truth**: Database + Storage + Auth + Edge Functions (no external dependencies except LLM APIs)
2. **Phase-Driven State Machine**: 30+ distinct phases map to 8 pipeline steps (0-7)
3. **A/B Generation Pattern**: Renders and panoramas generated in pairs (A/B variants) for quality comparison
4. **Camera-Aware Rendering**: Each render tied to specific camera marker with position, yaw, FOV
5. **QA Learning Loop**: Human feedback stored in qa_human_feedback → generates qa_policy_rules → influences future LLM-as-Judge evaluations

### Data Flow
```
Floor Plan Upload (Step 0)
  ↓ Space Analysis (Graph + Rooms)
  ↓ Top-Down 3D (Step 1)
  ↓ Style Application (Step 2)
  ↓ Camera Planning (Step 3) - User places camera markers
  ↓ Space Detection (Step 4) - Identify distinct rooms
  ↓ Renders (Step 5) - A/B renders per camera × space
  ↓ Panoramas (Step 6) - A/B 360° panoramas per space
  ↓ Merge (Step 7) - Final 360° per space
  ↓ Completed - All deliverables approved
```

### Key Constraints
- Frontend: React + Vite + TypeScript + shadcn/ui + Tailwind
- Backend: Supabase (Postgres + Storage + Edge Functions)
- Edge Functions: Deno runtime (59 functions deployed)
- State Management: phase + step + retry_state tracked in floorplan_pipelines table
- No schema changes without migrations

---

## 🔌 Phase 2: Link - Environment Analysis

### Required Environment Variables

**Frontend (Public Keys - .env):**
- `VITE_SUPABASE_PROJECT_ID` ✅
- `VITE_SUPABASE_ANON_KEY` ✅
- `VITE_SUPABASE_URL` ✅

**Backend (Private Keys - Supabase Secrets):**
- `SUPABASE_URL` (Database + Storage + Auth)
- `SUPABASE_SERVICE_ROLE_KEY` (Bypasses RLS)
- `SUPABASE_ANON_KEY` (RLS-enforced)
- `API_NANOBANANA` (Google Gemini API key - EXCLUSIVE LLM provider for ALL functionality: image generation, text analysis, prompt composition, QA evaluation, style analysis)
- `LANGFUSE_ENABLED`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL` (MANDATORY observability, tracing, prompt management)

**⚠️ REMOVED/OBSOLETE:**
- `API_OPENAI` - NOT USED. System uses Google Gemini exclusively for all LLM tasks.

### Edge Functions Analysis
- **Total Deployed:** 59 functions
- **Runtime:** Deno (TypeScript-native)
- **JWT Verification:** Disabled (verify_jwt = false for all)
- **Security Model:** Relies on RLS policies in database
- **Key Functions:** run-space-analysis, run-pipeline-step, run-batch-space-renders, run-batch-space-panoramas, run-batch-space-merges

### Project ID Mismatch
- `.env`: `zturojwgqtjrxwsfbwqw` (Production)
- `config.toml`: `pyswjfcqirszxelrsotw` (Local)
- **Conclusion:** Two separate projects (local testing vs. production)

### API Usage Patterns (Google Gemini - EXCLUSIVE)
- **Gemini API Base:** `https://generativelanguage.googleapis.com/v1beta/models`
- **Models Used:**
  - `gemini-2.5-pro` (text analysis, space analysis, QA evaluation, prompt composition, style analysis)
  - `gemini-2.0-flash-exp-image-generation` (image-to-image generation for all pipeline steps)
- **API Key:** `API_NANOBANANA` is used for ALL Gemini calls (custom naming convention)
- **LLM Provider:** Google Gemini ONLY. No OpenAI integration (legacy references ignored).

### Observability (MANDATORY)
- **Langfuse:** Required for tracing, prompt management, LLM-as-Judge evaluation
- **Status:** Active and mandatory (not optional)
- **Integration:** All Edge Functions use langfuse-client.ts wrapper

---

### Critical Corrections (2026-02-08 16:25)
- **OpenAI Removed:** System does NOT use OpenAI. All references to `API_OPENAI` are obsolete.
- **Gemini Exclusive:** ALL LLM functionality (prompt composition, analysis, QA, repair loops) handled by Google Gemini.
- **Langfuse Mandatory:** Observability is required, not optional. Langfuse must be active for production operation.

### Langfuse Connectivity Resolution (2026-02-08 16:50)
- **Root Cause:** `LANGFUSE_ENABLED` secret was missing from Supabase Secrets
- **Impact:** `isLangfuseEnabled()` returned `false`, causing all tracing to be skipped
- **Fix:** Adding `LANGFUSE_ENABLED=true` (exact lowercase, no quotes)
- **Configuration Note:** User has `LANGFUSE_HOST` but code expects `LANGFUSE_BASE_URL`
  - Code defaults to `https://cloud.langfuse.com` if `LANGFUSE_BASE_URL` not set
  - Acceptable if using Langfuse cloud; requires rename if self-hosted
- **Verification:** Pending Step 0 re-run to confirm traces appear

### Known Performance Issues
- **Style Analysis:** User reports "long-running / no-response" behavior
- **Diagnosis:** Will use Langfuse traces to identify bottleneck once connectivity confirmed
- **Possible Causes:** Edge Function timeout, Gemini API delays, large image processing

---

**Last Updated:** 2026-02-08 16:50 UTC
