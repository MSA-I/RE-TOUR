# 📋 Task Plan

**Project:** RE-TOUR
**Created:** 2026-02-08
**Status:** Awaiting Discovery

---

## 🎯 Mission Statement

**Build a stable, self-healing automation system that runs the RE:TOUR pipeline end-to-end:**

From **2D floor plan + optional design reference** → **space analysis** → **camera planning** → **renders / panoramas / 360** → **automated + manual QA** → **approved final deliverables**.

**Success Criteria:**
- Real projects can run without loops
- Architectural consistency maintained throughout
- Full traceability (all decisions logged)
- Clear QA decisions with explicit reasons
- All outputs accessible in system UI and storage
- Self-healing: errors trigger repair loops (log → diagnose → fix → validate → document)

---

## 📊 B.L.A.S.T. Phases

### ✅ Phase 0: Initialization
- [x] Create project memory files
- [x] Initialize gemini.md constitution
- [x] Complete Discovery Questions
- [x] Define Data Schema
- [ ] Get Blueprint approval ⏸️ AWAITING USER

### ✅ Phase 1: Blueprint (Vision & Logic)
- [x] Answer Discovery Questions
- [x] Define North Star outcome
- [x] Map integrations and APIs (Supabase, Gemini, OpenAI, Langfuse)
- [x] Document Source of Truth (Supabase: DB + Storage + Auth)
- [x] Design Delivery Payload (Dashboard UI + Storage + Notifications)
- [x] Establish Behavioral Rules (QA gates, step logic, "Do Not" rules)
- [x] Research external patterns (image pipelines, self-healing, LLM-as-Judge)
- [x] Document complete data schemas (Input/Output/State for all 8 steps)
- [x] User approval with reality validation constraints ✅ APPROVED

### 🟢 Phase 2: Link (Connectivity) - CURRENT
- [ ] Verify .env credentials (Supabase, Gemini, OpenAI, Langfuse)
- [ ] Test Supabase connection (database + storage + auth)
- [ ] Test API endpoints (Gemini, OpenAI, Langfuse)
- [ ] Verify Edge Functions deployment status
- [ ] Check observability stack (Langfuse traces)
- [ ] **Document connectivity findings in findings.md**

### 🚧 Reality Validation Gate (REQUIRED BEFORE PHASE 3)
- [ ] Run at least ONE full real pipeline (Step 0 → Step 7)
- [ ] Observe actual failure points
- [ ] Document QA friction and approval flow
- [ ] Test repair loop effectiveness
- [ ] Capture real error patterns and recovery behavior
- [ ] **Update gemini.md with real-world learnings**
- [ ] **Get checkpoint approval for Phase 3**

### ⬜ Phase 3: Architect (3-Layer Build) - PENDING CHECKPOINT
- [ ] ⚠️ **BLOCKED**: Requires Reality Validation Gate completion
- [ ] Create Architecture SOPs (Layer 1)
- [ ] Build Navigation logic (Layer 2)
- [ ] Develop Tools scripts (Layer 3)
- [ ] Implement self-annealing loops based on REAL failures

### ⬜ Phase 4: Stylize (Refinement)
- [ ] Format output payloads
- [ ] Apply UI/UX standards
- [ ] Get user feedback
- [ ] Polish edge cases

### ⬜ Phase 5: Trigger (Deployment)
- [ ] Transfer to production
- [ ] Set up automation triggers
- [ ] Finalize maintenance documentation

---

## 🚦 Current Blockers
- [x] ~~Awaiting Discovery Question responses~~ ✅ COMPLETE
- [x] ~~Cannot proceed to coding until schema is defined~~ ✅ COMPLETE
- [x] ~~Awaiting user approval of Blueprint~~ ✅ APPROVED (with reality validation gate)
- [ ] 🚧 **REALITY VALIDATION GATE**: Must run real pipeline before Phase 3

---

## 📝 Notes

### Existing Infrastructure
- **Frontend**: React 18.3 + Vite 5.4 + TypeScript 5.8 + shadcn/ui + Tailwind CSS (194 files)
- **Backend**: Supabase (62 migrations, 26 tables, 59 Edge Functions)
- **Pipeline**: 8-step workflow with phase-driven state machine (30+ phases)
- **QA System**: LLM-as-Judge + human feedback loop + policy learning
- **Storage**: 3 private S3 buckets with RLS (panoramas, design_refs, outputs)

### Schema Highlights
- **Primary State**: `floorplan_pipelines` table with `whole_apartment_phase` + `current_step`
- **Event Sourcing**: All transitions logged to `floorplan_pipeline_events`
- **Retry Logic**: `step_retry_state` JSONB with attempt counts and max limits
- **QA Persistence**: `qa_judge_results` stores all LLM evaluations with scores, confidence, violated rules
- **Camera System**: `pipeline_camera_markers` with normalized position + yaw + FOV + room binding

### Architecture Decisions
- **No auto-advance**: Manual approval required at all `*_review` phases
- **Strict order**: Step 0 must complete before any image generation
- **"Nice But Wrong" = REJECT**: QA enforces architectural rules even if output looks good
- **State integrity**: Database triggers auto-correct phase/step mismatches
- **Deterministic routing**: All mutations use `routeActionByPhase()` (no direct endpoint calls)

### Blueprint Constraints (User-Approved)
- **Living Blueprint**: `gemini.md` will evolve based on real pipeline behavior
- **Proposed Defaults**: Retry logic (3 attempts), backoff (1s/2s/4s), frameworks (DeepEval, XState) are starting points, not hard laws
- **Reality Validation Required**: Must run at least one full pipeline (Step 0 → 7) before building automation tooling
- **Phase 3 Checkpoint**: Requires approval after Phase 2 + real pipeline observation
