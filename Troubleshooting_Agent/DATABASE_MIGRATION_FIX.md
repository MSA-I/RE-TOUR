# Database Migration Fix Guide

**Issue:** Indexes already exist, causing migration failures
**Root Cause:** Partial migrations were applied previously
**Solution:** Use fixed idempotent migration scripts

---

## Step 1: Run Diagnostic Query

Run this first to see what already exists:

**File:** `supabase/migrations/00_DIAGNOSE_EXISTING_SCHEMA.sql`

```sql
-- Copy and paste into Supabase SQL Editor
-- This will show you:
-- - Which tables exist
-- - Which indexes exist
-- - Which columns exist
-- - Which RLS policies exist
-- - Which enum values exist
-- - Whether the trigger exists
```

This will tell you exactly what's already in your database.

---

## Step 2: Apply Fixed Migrations

Instead of the original migrations, use these FIXED versions:

### Migration 1: Camera Intents Table (FIXED)
**File:** `supabase/migrations/20260210140000_add_camera_intents_table_FIXED.sql`

**Changes from original:**
- ✅ Uses `CREATE TABLE IF NOT EXISTS`
- ✅ Checks if indexes exist before creating
- ✅ Drops and recreates policies (avoids duplicates)
- ✅ Safe to run multiple times

**Run this in Supabase SQL Editor**

### Migration 2: Final Prompts Table (FIXED)
**File:** `supabase/migrations/20260210140100_add_final_prompts_table_FIXED.sql`

**Changes from original:**
- ✅ Uses `CREATE TABLE IF NOT EXISTS`
- ✅ Checks if indexes exist before creating
- ✅ Drops and recreates policies (avoids duplicates)
- ✅ Safe to run multiple times

**Run this in Supabase SQL Editor**

### Migration 3: Update Pipeline Phases (Original is OK)
**File:** `supabase/migrations/20260210140200_update_pipeline_phases.sql`

This one should be fine as-is because it already uses `ADD VALUE IF NOT EXISTS`.

**Run this in Supabase SQL Editor**

### Migration 4: Update Phase-Step Constraint (Original is OK)
**File:** `supabase/migrations/20260210140300_update_phase_step_constraint.sql`

This one drops and recreates, so it's safe.

**Run this in Supabase SQL Editor**

---

## Step 3: Verify Everything Was Applied

Run these verification queries:

```sql
-- 1. Verify camera_intents table and columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'camera_intents'
ORDER BY ordinal_position;
-- Expected: 12 columns

-- 2. Verify final_prompts table and columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'final_prompts'
ORDER BY ordinal_position;
-- Expected: 13 columns

-- 3. Verify new enum values
SELECT e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
AND e.enumlabel IN (
  'camera_intent_pending',
  'camera_intent_confirmed',
  'prompt_templates_pending',
  'prompt_templates_confirmed',
  'outputs_pending',
  'outputs_in_progress',
  'outputs_review'
)
ORDER BY e.enumlabel;
-- Expected: 7 rows

-- 4. Verify trigger exists
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'enforce_phase_step_consistency';
-- Expected: 1 row, tgenabled = 'O' (enabled)

-- 5. Test that you can insert data (optional)
-- This creates a test intent and then deletes it
DO $$
DECLARE
  test_pipeline_id UUID;
  test_space_id UUID;
  test_user_id UUID;
  test_intent_id UUID;
BEGIN
  -- Get a real pipeline, space, and user ID from your DB
  SELECT id INTO test_pipeline_id FROM floorplan_pipelines LIMIT 1;
  SELECT id INTO test_space_id FROM floorplan_pipeline_spaces LIMIT 1;
  SELECT id INTO test_user_id FROM auth.users LIMIT 1;

  IF test_pipeline_id IS NOT NULL AND test_space_id IS NOT NULL AND test_user_id IS NOT NULL THEN
    -- Try to insert
    INSERT INTO camera_intents (
      pipeline_id,
      space_id,
      owner_id,
      suggestion_text,
      suggestion_index,
      space_size_category
    ) VALUES (
      test_pipeline_id,
      test_space_id,
      test_user_id,
      'Test camera intent',
      0,
      'normal'
    ) RETURNING id INTO test_intent_id;

    -- Clean up
    DELETE FROM camera_intents WHERE id = test_intent_id;

    RAISE NOTICE 'Test passed: camera_intents table is working';
  ELSE
    RAISE NOTICE 'Skipping test: no test data available';
  END IF;
END $$;
```

---

## What Each Fixed Migration Does

### 20260210140000_add_camera_intents_table_FIXED.sql

**Creates:**
- `camera_intents` table (if not exists)
- 3 indexes (only if they don't exist)
- 3 RLS policies (drops old ones first to avoid duplicates)

**Columns:**
- `id` (UUID, primary key)
- `pipeline_id` (UUID, foreign key)
- `space_id` (UUID, foreign key)
- `owner_id` (UUID, foreign key to auth.users)
- `suggestion_text` (TEXT)
- `suggestion_index` (INT)
- `space_size_category` (TEXT, CHECK: 'large' or 'normal')
- `is_selected` (BOOLEAN)
- `selected_at` (TIMESTAMPTZ)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

### 20260210140100_add_final_prompts_table_FIXED.sql

**Creates:**
- `final_prompts` table (if not exists)
- 3 indexes (only if they don't exist)
- 3 RLS policies (drops old ones first to avoid duplicates)

**Columns:**
- `id` (UUID, primary key)
- `pipeline_id` (UUID, foreign key)
- `space_id` (UUID, foreign key)
- `owner_id` (UUID, foreign key to auth.users)
- `prompt_template` (TEXT)
- `final_composed_prompt` (TEXT)
- `image_count` (INT, CHECK: 1-10)
- `source_camera_intent_ids` (UUID[])
- `nanobanana_job_id` (TEXT)
- `status` (TEXT, CHECK: pending/queued/generating/complete/failed)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)
- `executed_at` (TIMESTAMPTZ)
- `completed_at` (TIMESTAMPTZ)

---

## Troubleshooting

### Error: "relation already exists"
**Solution:** The fixed versions handle this. The table already exists, so `CREATE TABLE IF NOT EXISTS` will skip it.

### Error: "index already exists"
**Solution:** The fixed versions check if indexes exist before creating them using a `DO` block.

### Error: "policy already exists"
**Solution:** The fixed versions drop existing policies before creating new ones.

### Error: "enum value already exists"
**Solution:** Migration 3 already uses `ADD VALUE IF NOT EXISTS`, so this shouldn't happen.

### Still getting errors?
1. Run the diagnostic query first
2. Check the output - what already exists?
3. Compare with what the migration is trying to create
4. If needed, manually drop the problematic item first:
   ```sql
   -- Example: Drop an index
   DROP INDEX IF EXISTS idx_camera_intents_pipeline;

   -- Example: Drop a policy
   DROP POLICY IF EXISTS "policy_name" ON table_name;
   ```

---

## Quick Reference: Migration Order

Run in this order:

1. ✅ `00_DIAGNOSE_EXISTING_SCHEMA.sql` (diagnostic)
2. ✅ `20260210140000_add_camera_intents_table_FIXED.sql`
3. ✅ `20260210140100_add_final_prompts_table_FIXED.sql`
4. ✅ `20260210140200_update_pipeline_phases.sql` (original)
5. ✅ `20260210140300_update_phase_step_constraint.sql` (original)

---

## Expected Results

After all migrations:

### Tables
- ✅ `camera_intents` exists with 12 columns
- ✅ `final_prompts` exists with 13 columns

### Indexes
- ✅ `idx_camera_intents_pipeline`
- ✅ `idx_camera_intents_space`
- ✅ `idx_camera_intents_selected`
- ✅ `idx_final_prompts_pipeline`
- ✅ `idx_final_prompts_space`
- ✅ `idx_final_prompts_status`

### RLS Policies
- ✅ 3 policies on `camera_intents` (SELECT, INSERT, UPDATE)
- ✅ 3 policies on `final_prompts` (SELECT, INSERT, UPDATE)

### Enum Values
- ✅ 7 new values in `whole_apartment_phase` enum

### Trigger
- ✅ `enforce_phase_step_consistency` trigger active

---

## Next Steps After Migration

Once migrations are successful:

1. ✅ Verify with queries above
2. ✅ Proceed with component integration (see PHASE_3_REFACTORING_GUIDE.md)
3. ✅ Test E2E pipeline flow
4. ✅ Apply accessibility polish (see PHASE_5_ACCESSIBILITY_SUMMARY.md)

---

**Status:** Ready to apply fixed migrations ✅
