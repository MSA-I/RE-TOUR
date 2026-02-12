# Step 6 Migration Ready - Summary

**Date**: 2026-02-12
**Status**: ✅ Migration file created and ready to apply
**Build Status**: ✅ Passes (no errors)

---

## What's Been Completed ✅

### 1. Migration File Created
**File**: `supabase/migrations/20260212000000_add_final_prompts_output_fields.sql`

**Adds to `final_prompts` table:**
- 11 new columns (output fields, QA fields, approval fields)
- 3 performance indexes
- 1 foreign key constraint
- Full documentation comments

**Migration is idempotent:**
- Safe to run multiple times
- Uses `IF NOT EXISTS` checks
- Won't fail if columns already exist

### 2. TypeScript Interface Updated
**File**: `src/contexts/PipelineContext.tsx`

**Updated `FinalPrompt` interface with:**
- Output fields: `output_upload_ids`, `attempt_number`
- QA fields: `qa_status`, `qa_report`, `qa_score`, `qa_feedback`, `qa_reason`
- Approval fields: `manual_approved`, `locked_approved`, `approved_at`, `approved_by`

**Build verified:** ✅ No type errors

### 3. Documentation Created
**Files:**
- `STEP6_MIGRATION_INSTRUCTIONS.md` - Detailed migration guide
- `STAGEREW_PANEL_INTEGRATION_STATUS.md` - Full integration status
- `MIGRATION_READY_SUMMARY.md` - This file

---

## What You Need to Do Next ⏭️

### Step 1: Apply the Database Migration

**Option A: Supabase SQL Editor (Easiest)**

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Click **New Query**
4. Open the file: `supabase/migrations/20260212000000_add_final_prompts_output_fields.sql`
5. Copy the entire contents
6. Paste into the SQL Editor
7. Click **Run** (or press `Ctrl+Enter`)

**Option B: Supabase CLI**

```bash
cd A:/RE-TOUR
supabase db push
```

### Step 2: Verify Migration Success

Run these verification queries in the SQL Editor:

**Verify columns exist:**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'final_prompts'
AND column_name IN (
  'output_upload_ids', 'qa_status', 'qa_report', 'qa_score',
  'manual_approved', 'locked_approved', 'attempt_number'
);
```

**Expected:** 7+ rows

**Verify indexes exist:**
```sql
SELECT indexname
FROM pg_indexes
WHERE tablename = 'final_prompts'
AND indexname LIKE 'idx_final_prompts_%';
```

**Expected:** 3+ rows

### Step 3: Report Back

After applying the migration, let me know:
- ✅ "Migration applied successfully" - I'll proceed with backend updates
- ❌ "Got errors: [paste errors]" - I'll help troubleshoot

---

## What Happens After Migration ⏭️

Once you confirm the migration is applied, I will:

1. **Update Backend Edge Function**
   - Modify `run-batch-space-outputs` to populate new fields
   - Add QA validation for generated outputs
   - Store output upload IDs and QA results

2. **Implement Step 6 UI**
   - Add per-space `StageReviewPanel` components
   - Display generated images with QA results
   - Add per-space approval/rejection buttons
   - Add batch approval option

3. **Test E2E**
   - Verify complete pipeline flow
   - Test QA integration
   - Test approval workflows

---

## Migration Details

### Schema Changes

**Table:** `final_prompts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `output_upload_ids` | `text[]` | `ARRAY[]::text[]` | Array of upload IDs for generated images |
| `qa_status` | `text` | `NULL` | QA decision: approved/failed/pending |
| `qa_report` | `jsonb` | `NULL` | Detailed QA report with criteria |
| `qa_score` | `numeric` | `NULL` | Numeric QA score (0-100) |
| `qa_feedback` | `text` | `NULL` | Human-readable feedback |
| `qa_reason` | `text` | `NULL` | Rejection reason (if failed) |
| `manual_approved` | `boolean` | `false` | Manual QA override flag |
| `locked_approved` | `boolean` | `false` | Locked approval (immutable) |
| `attempt_number` | `integer` | `1` | Retry tracking |
| `approved_at` | `timestamptz` | `NULL` | Approval timestamp |
| `approved_by` | `uuid` | `NULL` | User who approved (FK to auth.users) |

### Indexes Created

1. `idx_final_prompts_qa_status` - Query by QA status
2. `idx_final_prompts_approved` - Query approved outputs
3. `idx_final_prompts_attempt` - Query by pipeline, space, and attempt

### Constraints

- Foreign key: `final_prompts_approved_by_fkey` → `auth.users(id)`

---

## Risk Assessment

**Risk Level:** LOW ✅

**Reasons:**
- ✅ Migration is idempotent (safe to run multiple times)
- ✅ Only adds new columns (doesn't modify existing data)
- ✅ Doesn't break existing functionality
- ✅ Build already passes with TypeScript changes
- ✅ Rollback plan documented (if needed)

**Potential Issues:**
- ⚠️ If `auth.users` table doesn't exist, foreign key creation may fail
  - **Solution:** Migration will skip FK and continue
- ⚠️ Large `final_prompts` table may take time to add columns
  - **Impact:** Minimal (likely <1 second)

---

## Rollback Plan (If Needed)

If migration causes issues, run this to rollback:

```sql
-- Remove all new columns (DANGER: Loses data)
ALTER TABLE final_prompts
  DROP COLUMN IF EXISTS output_upload_ids,
  DROP COLUMN IF EXISTS qa_status,
  DROP COLUMN IF EXISTS qa_report,
  DROP COLUMN IF EXISTS qa_score,
  DROP COLUMN IF EXISTS qa_feedback,
  DROP COLUMN IF EXISTS qa_reason,
  DROP COLUMN IF EXISTS manual_approved,
  DROP COLUMN IF EXISTS locked_approved,
  DROP COLUMN IF EXISTS attempt_number,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by;

-- Drop indexes
DROP INDEX IF EXISTS idx_final_prompts_qa_status;
DROP INDEX IF EXISTS idx_final_prompts_approved;
DROP INDEX IF EXISTS idx_final_prompts_attempt;
```

**⚠️ WARNING:** Only use if absolutely necessary. This deletes all data in the new columns.

---

## Progress Summary

| Task | Status | Notes |
|------|--------|-------|
| Steps 1 & 2 StageReviewPanel | ✅ Complete | Full QA integration working |
| Step 6 Database Schema | ✅ Ready | Migration file created |
| Step 6 TypeScript Interface | ✅ Complete | Build passes |
| Step 6 Backend Function | ⏭️ Pending | After migration |
| Step 6 UI Implementation | ⏭️ Pending | After migration |
| E2E Testing | ⏭️ Pending | Final step |

**Overall Progress:** 50% complete (3 of 6 tasks done)

---

## Quick Start

**Copy/paste this into Supabase SQL Editor:**

1. Open file: `A:\RE-TOUR\supabase\migrations\20260212000000_add_final_prompts_output_fields.sql`
2. Copy entire contents
3. Paste into SQL Editor
4. Click Run
5. Report back: "Migration applied successfully" or paste any errors

**Verification query (run after migration):**

```sql
SELECT COUNT(*)
FROM information_schema.columns
WHERE table_name = 'final_prompts'
AND column_name IN (
  'output_upload_ids', 'qa_status', 'qa_report',
  'manual_approved', 'locked_approved', 'attempt_number'
);
```

**Expected result:** 6 (or more)

---

**Status**: ✅ Ready to apply
**Next Action**: Apply migration in Supabase SQL Editor
**Estimated Time**: 2-3 minutes
**Risk**: LOW
**Rollback**: Available if needed

Let me know when the migration is applied and I'll proceed with the backend and UI implementation! 🚀
