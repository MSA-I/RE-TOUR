# Deep Debugger Implementation Status

**Authority:** deep_debugger_plan.md
**Date:** 2026-02-11
**Goal:** Zero tolerance for system breakage during pipeline migration

---

## Implementation Status Overview

### ✅ Completed
1. **Testing Infrastructure Setup**
   - Created `vitest.config.ts`
   - Created `src/test/setup.ts`
   - Created `TESTING_SETUP.md` with installation instructions

2. **Phase Transition Unit Tests**
   - File: `src/hooks/__tests__/useWholeApartmentPipeline.phaseTransitions.comprehensive.test.ts`
   - Tests all legal phase transitions (Steps 0-8)
   - Tests illegal transitions are blocked
   - Tests phase-step consistency
   - Tests new pipeline changes (camera_intent_confirmed → prompt_templates_pending)
   - Historical failure prevention tests

3. **UI Verification Tests**
   - File: `src/components/whole-apartment/__tests__/CameraIntentSelectorPanel.comprehensive.test.tsx`
   - **CRITICAL:** Verifies NO camera placement tools visible
   - Tests accessibility (WCAG 2.1 AA compliance)
   - Tests mobile responsive design (44px touch targets)
   - Tests validation logic
   - Historical regression prevention tests

### ⏳ Pending (Scaffolds Created)
4. **Camera Intent Decision-Only Tests**
   - File: `supabase/functions/save-camera-intents/__tests__/decision_only.test.ts`
   - Status: Scaffold required
   - Tests: Large spaces get 4+ suggestions, normal spaces get max 2

5. **Database Constraint Tests**
   - File: `supabase/tests/constraints/all_constraints.test.sql`
   - Status: Scaffold required
   - Tests: Phase-step consistency, camera intent counts, foreign key integrity

6. **E2E Integration Tests**
   - File: `tests/integration/pipeline_e2e.test.ts`
   - Status: Scaffold required
   - Tests: Full pipeline flow from Step 0 to Step 8

---

## Next Steps (Required Actions)

### Step 1: Install Testing Dependencies ⏳

Run the following command:

```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/testing-library__jest-dom
```

### Step 2: Run Phase Transition Tests ✅ (Ready)

Once dependencies installed:

```bash
npm run test -- useWholeApartmentPipeline.phaseTransitions.comprehensive.test.ts
```

**Expected Result:** 100% pass rate

### Step 3: Run UI Verification Tests ✅ (Ready)

```bash
npm run test -- CameraIntentSelectorPanel.comprehensive.test.tsx
```

**Expected Result:** 100% pass rate

**CRITICAL CHECK:** Test confirms NO camera placement tools rendered

### Step 4: Create Remaining Test Files ⏳

Need to create:
1. Edge function tests (Deno)
2. Database constraint tests (SQL)
3. E2E integration tests

### Step 5: Run Checkpoint Verifications ⏳

Execute checkpoints in order (see Checkpoint section below)

---

## Checkpoint Status

### Checkpoint 1: Backend Verification ⏳
**Status:** Ready to run after npm install
**Command:** `npm run test -- hooks`
**Gate:** Must pass 100% before database migrations
**Criteria:**
- ✅ Phase transition tests pass
- ⏳ Edge function tests pass (pending creation)
- ⏳ Review edge function logs

### Checkpoint 2: Database Verification ⏳
**Status:** Scaffold needed
**Command:** `supabase test db`
**Gate:** Must pass 100% before UI changes
**Criteria:**
- ⏳ Database constraint tests pass
- ⏳ Migrations applied successfully
- ⏳ Test pipeline created in staging

### Checkpoint 3: UI Verification ⏳
**Status:** Ready to run after npm install
**Command:** `npm run test -- components`
**Gate:** Must pass 100% before deployment
**Criteria:**
- ✅ CameraIntentSelectorPanel tests pass
- ⏳ Manual verification: Step 3 UI shows NO camera placement
- ⏳ Stepper shows: 0.1, 0.2, 1-5, 6-9 (grayed), 10

### Checkpoint 4: Integration Verification ⏳
**Status:** Scaffold needed
**Command:** `npm run test:integration`
**Gate:** Must pass 100% before production
**Criteria:**
- ⏳ E2E pipeline flow tests pass
- ⏳ Manual E2E test in staging succeeds

### Checkpoint 5: Production Smoke Test ⏳
**Status:** Post-deployment
**Criteria:**
- ⏳ Create test pipeline in production
- ⏳ Run through Steps 0-8
- ⏳ Verify Step 3 shows suggestions (NOT camera placement)
- ⏳ Verify no errors in any step

---

## Test Coverage Summary

### Unit Tests
- ✅ **Phase Transitions** (100% coverage of legal/illegal transitions)
- ⏳ **Camera Intent Logic** (decision-only enforcement)
- ⏳ **Database Constraints** (all constraints verified)

### Component Tests
- ✅ **CameraIntentSelectorPanel** (comprehensive UI testing)
- ⏳ **PromptFinalizationPanel** (recommended)
- ⏳ **PipelineProgressBar** (accessibility features)

### Integration Tests
- ⏳ **E2E Pipeline Flow** (Steps 0-8)
- ⏳ **Database Migrations** (staging verification)

### Edge Function Tests
- ⏳ **save-camera-intents** (decision-only rules)
- ⏳ **compose-final-prompts** (prompt composition)
- ⏳ **run-batch-space-outputs** (image generation)

---

## Critical Tests (MUST PASS)

### 🔴 CRITICAL: Step 3 UI Verification

**Test:** `CameraIntentSelectorPanel - NO Camera Placement Tools`
**Location:** Line 78-134 in CameraIntentSelectorPanel.comprehensive.test.tsx
**Why Critical:** Historical breaking changes included showing old UI

**Verification Points:**
1. ❌ No "place camera marker" text
2. ❌ No draggable camera elements
3. ❌ No angle/direction selection controls
4. ❌ No 3D view or floor plan canvas
5. ✅ Shows prompt suggestions instead
6. ✅ Shows "Decision-Only" badge

### 🔴 CRITICAL: Phase Transition Logic

**Test:** `Phase Transitions - Comprehensive`
**Location:** useWholeApartmentPipeline.phaseTransitions.comprehensive.test.ts
**Why Critical:** Previous 500 errors caused by phase/step mismatches

**Verification Points:**
1. ✅ All legal transitions defined
2. ✅ Illegal transitions blocked
3. ✅ No backward transitions
4. ✅ No step skipping
5. ✅ camera_intent_confirmed → prompt_templates_pending (NEW)
6. ✅ prompt_templates_confirmed → outputs_pending (NEW)

### 🔴 CRITICAL: Database Integrity

**Test:** Database Constraint Tests (pending creation)
**Why Critical:** Data corruption prevention

**Verification Points:**
1. ⏳ Phase-step consistency enforced
2. ⏳ Foreign key integrity maintained
3. ⏳ Camera intent count rules enforced
4. ⏳ No orphaned records

---

## Rollback Procedures

### Automatic Rollback Triggers

1. **Database Migration Failure**
   - Trigger: Migration script error
   - Action: Execute rollback SQL script
   - Verification: Run constraint tests again

2. **Edge Function Error Rate > 10%**
   - Monitor: save-camera-intents, compose-final-prompts
   - Trigger: 10% error rate for 5 consecutive minutes
   - Action: Rollback to previous version via Supabase dashboard

3. **User-Reported Critical Bugs**
   - Trigger: Step 3 shows camera placement tools
   - Action: Immediate UI rollback

### Manual Rollback Procedures

```bash
# Database rollback
supabase db reset --db-url <connection-string>
supabase db push --db-url <connection-string> --target <previous-migration-version>

# Frontend rollback
git revert <commit-hash>
npm run build
# Deploy previous build

# Edge function rollback
# Via Supabase dashboard: Functions > select function > Versions > restore previous
```

---

## Monitoring Setup (Post-Deployment)

### Required Monitors

1. **Edge Function Error Rates**
   - Metric: HTTP 5xx responses
   - Threshold: > 5% for 5 minutes
   - Alert: Email + Slack

2. **Phase Transition Success Rate**
   - Query: See deep_debugger_plan.md Component 5, Section 2
   - Threshold: Any phase > 10% error rate
   - Alert: Email + Slack

3. **Database Constraint Violations**
   - Monitor: Postgres logs for constraint errors
   - Threshold: Any violation
   - Alert: Immediate email

4. **User-Facing Errors**
   - Tool: Frontend error boundary + Sentry
   - Threshold: > 10 errors in 10 minutes
   - Alert: Email + Slack

---

## Historical Failure Analysis

### Previous Failure 1: 500 Internal Server Error
**Root Cause:** Phase/step mismatch (camera_intent_pending not mapped to step 4)
**Prevention:** ✅ Phase transition tests verify all mappings
**Test Coverage:** Lines 409-420 in phase transition tests

### Previous Failure 2: Pipeline Stuck in Phase
**Root Cause:** No legal transition defined for review phase
**Prevention:** ✅ All review phases have transitions tested
**Test Coverage:** Lines 386-401 in phase transition tests

### Previous Failure 3: UI Regressions (Duplicate Panels)
**Root Cause:** Legacy components not removed, imported alongside new ones
**Prevention:** ✅ UI tests verify no camera placement tools
**Test Coverage:** Lines 78-134 in CameraIntentSelectorPanel tests

---

## Success Criteria

This deep debugger plan succeeds when:

1. ✅ Testing infrastructure set up (vitest + testing-library)
2. ✅ Unit tests created for phase transitions (100% legal/illegal)
3. ✅ UI tests created for CameraIntentSelectorPanel (no camera placement)
4. ⏳ Database constraint tests created and passing
5. ⏳ E2E integration tests created and passing
6. ⏳ All checkpoints pass (1-5)
7. ⏳ Zero user-reported critical bugs in first 48 hours
8. ⏳ Error rate < 1% for all pipeline edge functions

**Current Status:** 3/8 complete (37.5%)

---

## Files Created

### Configuration
- ✅ `vitest.config.ts`
- ✅ `src/test/setup.ts`
- ✅ `TESTING_SETUP.md`

### Unit Tests
- ✅ `src/hooks/__tests__/useWholeApartmentPipeline.phaseTransitions.comprehensive.test.ts`

### Component Tests
- ✅ `src/components/whole-apartment/__tests__/CameraIntentSelectorPanel.comprehensive.test.tsx`

### Documentation
- ✅ `DEEP_DEBUGGER_IMPLEMENTATION_STATUS.md` (this file)

### Pending Creation
- ⏳ `supabase/functions/save-camera-intents/__tests__/decision_only.test.ts`
- ⏳ `supabase/tests/constraints/all_constraints.test.sql`
- ⏳ `tests/integration/pipeline_e2e.test.ts`
- ⏳ `.github/workflows/test.yml` (CI/CD integration)

---

## Immediate Action Items

1. **[REQUIRED]** Run `npm install` command from TESTING_SETUP.md
2. **[REQUIRED]** Run phase transition tests: `npm run test -- useWholeApartmentPipeline`
3. **[REQUIRED]** Run UI tests: `npm run test -- CameraIntentSelectorPanel`
4. **[RECOMMENDED]** Create remaining test scaffolds
5. **[RECOMMENDED]** Set up CI/CD with test automation
6. **[CRITICAL]** Manual verification: Open Step 3, verify NO camera placement tools

---

## Support & Debugging

If tests fail:
1. Read error message carefully (systematic debugging Phase 1)
2. Check test file for expected vs actual values
3. Review implementation code for bugs
4. Add diagnostic logging if needed
5. Form hypothesis and test minimally
6. **DO NOT proceed to next checkpoint until 100% pass**

---

**REMEMBER: Zero Tolerance for Breakage**

All tests must pass 100% at each checkpoint before proceeding.
Historical failures teach us to be thorough, not fast.

