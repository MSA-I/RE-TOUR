# Fix: Missing camera_intents_with_spaces View

**Date:** 2026-02-11
**Status:** ⚠️ Action Required
**Issue:** 404 error when creating pipeline - view doesn't exist
**Error:** "Could not find the table 'public.camera_intents_with_spaces' in the schema cache"

---

## The Problem

When you create a new pipeline, the frontend tries to query a database view called `camera_intents_with_spaces`, but this view doesn't exist in your database yet because the migrations haven't been applied.

**Error in Console:**
```
GET .../camera_intents_with_spaces?pipeline_id=eq.... 404 (Not Found)
{code: 'PGRST205', message: "Could not find the table 'public.camera_intents_with_spaces' in the schema cache"}
```

---

## Quick Fix: Run SQL in Supabase Dashboard

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**

### Step 2: Run the Hotfix SQL

Copy and paste the contents of `HOTFIX_CREATE_VIEW_CORRECT.sql` (in the root directory) into the SQL editor, or paste this:

```sql
-- Create the view (CORRECTED VERSION)
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  s.name AS space_name,
  s.space_type AS space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;

-- Grant access to authenticated and anon roles
GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_space_selected
ON camera_intents(space_id, is_selected) WHERE is_selected = TRUE;

-- Verify the view was created
SELECT 'View created successfully!' AS status;
```

### Step 3: Click "Run" (or press Ctrl+Enter)

You should see: `View created successfully!`

### Step 4: Test Pipeline Creation

1. Go back to your app
2. Try creating a new pipeline
3. The 404 error should be gone

---

## Why This Happened

The migration `20260210150001_activate_camera_intents.sql` contains SQL to create this view, but:

1. **Wrong table structure:** The migration assumed a complex table structure with `standing_space_id` and `target_space_id`, but your database has the simple structure with just `space_id`
2. **Not applied:** Even if the structure was correct, this migration hasn't been applied to your remote database yet

**Root cause:** There are two different versions of the `camera_intents` table in your migrations directory, and the view was written for the wrong version.

**Migration Status:**
```
Local          | Remote         | Status
20260210150001 |                | ❌ NOT APPLIED
```

There's a mismatch between your local migration files and the remote database migration history, which is why `supabase db pull` failed.

---

## Proper Long-Term Fix: Sync Migrations

### Option A: Repair Migration History (Recommended)

If you want to properly sync your migrations:

```bash
# Mark the remote-only migrations as reverted
supabase migration repair --status reverted 20260211194439
supabase migration repair --status reverted 20260211194544
supabase migration repair --status reverted 20260211194553

# Mark the local migrations as applied
supabase migration repair --status applied 20250211_add_camera_intents_table
supabase migration repair --status applied 20250211_add_final_prompts_table
supabase migration repair --status applied 20250211_update_pipeline_phases
supabase migration repair --status applied 20250211_update_phase_step_constraint
supabase migration repair --status applied 20260210105014
supabase migration repair --status applied 20260210114213
supabase migration repair --status applied 20260210150000
supabase migration repair --status applied 20260210150001
supabase migration repair --status applied 20260211000000

# Then push any future migrations
supabase db push
```

### Option B: Fresh Start (Nuclear Option)

⚠️ **WARNING:** This will reset your migration history. Only do this if you're okay with potential data loss.

```bash
# Reset migration history
supabase db reset

# Push all migrations
supabase db push
```

---

## What the View Does

`camera_intents_with_spaces` is a helper view that joins the `camera_intents` table with space names for easier querying:

**Structure:**
```sql
camera_intents (raw data)
  + standing_space_name (from floorplan_pipeline_spaces)
  + standing_space_type
  + target_space_name
  + target_space_type
= camera_intents_with_spaces (enriched view)
```

**Used By:**
- `src/components/WholeApartmentPipelineCard.tsx:2169` - Queries camera intents for Step 3 UI

---

## Verification

After running the SQL, verify the view exists:

### In Supabase Dashboard:

1. Go to **Table Editor**
2. Look for `camera_intents_with_spaces` in the list
3. Should show as a **VIEW** (not a table)

### In SQL Editor:

```sql
SELECT * FROM camera_intents_with_spaces LIMIT 1;
```

Should return: `0 rows` (or data if you have camera intents) with no error.

---

## Related Files

**Hotfix SQL:**
- `HOTFIX_CREATE_VIEW_CORRECT.sql` - ✅ CORRECT SQL to run in dashboard (matches your table structure)
- `HOTFIX_CREATE_VIEW.sql` - ❌ WRONG (was for complex table structure - ignore this file)

**Migration Files:**
- `supabase/migrations/20260210150001_activate_camera_intents.sql` - Creates the view
- `supabase/migrations/20260211000000_fix_camera_intents_view_access.sql` - Grants permissions

**Frontend:**
- `src/components/WholeApartmentPipelineCard.tsx:2169` - Queries the view

---

## Summary of All Fixes Today

You now have **THREE fixes** to apply:

### Fix #1: Pipeline Creation (Frontend)
- **Status:** ✅ Fixed in code
- **File:** `src/hooks/useFloorplanPipelines.ts`
- **Test:** Create new pipeline

### Fix #2: Phase Transition (Backend)
- **Status:** ✅ Deployed
- **File:** `supabase/functions/continue-pipeline-step/index.ts`
- **Test:** Advance from Step 2 to Step 3

### Fix #3: Missing View (Database) ← **CURRENT**
- **Status:** ⏳ Action Required
- **Fix:** Run `HOTFIX_CREATE_VIEW.sql` in Supabase dashboard
- **Test:** Create pipeline without 404 error

---

## Testing Checklist

After running the hotfix SQL:

- [ ] Run SQL in Supabase dashboard
- [ ] See "View created successfully!" message
- [ ] Refresh your app (hard refresh: Ctrl+F5)
- [ ] Try creating a new pipeline
- [ ] No 404 error for camera_intents_with_spaces
- [ ] No 400 error for phase/step mismatch (Fix #1)
- [ ] Pipeline created successfully

---

## Success Criteria

**All three fixes will be complete when:**
- [ ] Can create new pipeline without errors
- [ ] Can advance from Step 2 to Step 3 without errors
- [ ] No 404 errors for missing views
- [ ] No 400 errors for phase/step mismatch
- [ ] Pipeline flows smoothly from creation through completion

---

## Current Status

**Fix #1 (Pipeline Creation):** ✅ Code fixed, pending test
**Fix #2 (Phase Transition):** ✅ Deployed, pending test
**Fix #3 (Missing View):** ⏳ **RUN HOTFIX SQL NOW**

**Next Action:** Run `HOTFIX_CREATE_VIEW.sql` in Supabase dashboard, then test pipeline creation.
