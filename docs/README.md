# RE:TOUR Documentation Structure

This directory contains all project documentation organized by purpose. **All new documentation files must go in the appropriate subdirectory below, NOT in the root.**

## Directory Structure

### `/phases` - Implementation Phases
Phase-by-phase implementation documentation tracking major feature rollouts.

**Examples:**
- `PHASE_1_DATABASE_MIGRATION_GUIDE.md`
- `PHASE_3_REFACTORING_GUIDE.md`
- `PHASE_5_DEPLOYMENT_PLAN.md`

**When to use:** Documenting multi-step implementation phases, architectural changes, or major feature rollouts.

---

### `/features` - Feature Implementation
Complete guides for specific features, including setup, architecture, and usage.

**Examples:**
- `SETUP_GEMINI_CAMERA_INTENTS.md`
- `LANGFUSE_INTEGRATION.md`
- `QA_LEARNING_SYSTEMS_OVERVIEW.md`
- `PROGRESSIVE_QA_LEARNING_IMPLEMENTATION.md`

**When to use:** Documenting new features, integrations, or systems. Include architecture decisions, setup steps, and usage patterns.

---

### `/testing` - QA & Testing
Testing procedures, deployment checklists, and verification guides.

**Examples:**
- `DEPLOYMENT_TEST_CHECKLIST.md`
- `E2E_VERIFICATION_CHECKLIST.md`
- `MANUAL_TESTING_CHECKLIST.md`

**When to use:** Creating test plans, QA procedures, or deployment verification checklists.

---

### `/fixes` - Bug Fixes & Repairs
Documentation of bugs fixed and repairs completed.

**Examples:**
- `CRITICAL_FIX_PHASE_STEP_MISMATCH.md`
- `DATABASE_MIGRATION_FIX.md`
- `STEP6_IMPLEMENTATION_COMPLETE.md`
- `WIRING_FIXES_COMPLETE.md`

**When to use:** Documenting bug investigations, root cause analysis, and fix implementations. Include context, diagnosis, and solution.

---

### `/local-development` - Dev Environment Setup
Local development setup guides and troubleshooting for dev environments.

**Examples:**
- `LOCAL_DEV_QUICKSTART.md`
- `LOCAL_SUPABASE_SETUP_COMPLETE.md`

**When to use:** Creating local dev setup instructions, environment configuration guides, or local troubleshooting steps.

---

### `/troubleshooting` - Debug Guides
Active troubleshooting guides for known issues and their resolutions.

**Examples:**
- `DEBUG_STEP_1_ERROR_546.md`
- `TROUBLESHOOTING_JSON_PARSE_ERRORS.md`
- `TROUBLESHOOTING_EMPTY_RESPONSE.md`

**When to use:** Documenting recurring issues, error patterns, and their debugging steps. Include symptoms, diagnosis, and resolution.

---

### `/setup` - One-Time Setup
One-time setup instructions for features or systems.

**Examples:**
- `SETUP_GEMINI_CAMERA_INTENTS.md` (moved to /features)

**When to use:** Initial configuration guides that are run once during project setup or feature enablement.

---

### `/sql` - SQL Utilities
Reusable SQL scripts and database utilities.

**Examples:**
- `REGENERATE_CAMERA_INTENTS.sql`
- `verify_db.sql`

**When to use:** Creating SQL scripts for database maintenance, verification, or batch operations.

---

### `/legacy` - Completed/Historical Work
Archived documentation from completed phases, old implementations, or superseded approaches.

**Examples:**
- `STEP_0_FIXES_COMPLETE.md`
- `PIPELINE_REFACTOR_PLAN.md`
- `EDGE_FUNCTION_MEMORY_FIXES.md`

**When to use:** Moving completed work that's no longer actively referenced but may have historical value. Don't delete—archive here instead.

---

### `/archived-frozen` - Pre-Existing Archives
Historical archives from before the 2026-02-16 reorganization. Read-only reference.

**When to use:** Don't add new files here. This is frozen historical content.

---

## Quick Decision Tree

```
Creating a new file? Ask yourself:

1. Is it a build config or core memory file (README.md, task_plan.md)?
   → Root directory (but this should be rare!)

2. Is it documenting a multi-phase implementation?
   → docs/phases/

3. Is it a feature implementation guide?
   → docs/features/

4. Is it a bug fix or repair summary?
   → docs/fixes/

5. Is it a test plan or checklist?
   → docs/testing/

6. Is it a troubleshooting/debug guide?
   → docs/troubleshooting/

7. Is it local dev setup instructions?
   → docs/local-development/

8. Is it a SQL utility script?
   → docs/sql/

9. Is it completed work no longer actively used?
   → docs/legacy/

10. Is it a temporary diagnostic or debug output?
    → local_supabase/debug/ (NOT committed to git)
```

---

## File Naming Conventions

- **Use descriptive names:** `FEATURE_QA_LEARNING_IMPLEMENTATION.md` not `notes.md`
- **Use SCREAMING_SNAKE_CASE:** for consistency with existing files
- **Include context in the name:** `FIX_STEP2_EDGE_FUNCTION_ERROR.md` tells you what was fixed
- **Date-stamp if temporary:** `LOCAL_SETUP_FIX_2026-02-16.md`

---

## Maintenance

- **Move to legacy when done:** If a feature is complete and stable, move its docs to `/legacy`
- **Don't duplicate:** Search existing docs before creating new ones
- **Update this README:** If you add a new category, document it here

---

Last updated: 2026-02-16 (Repository reorganization)
