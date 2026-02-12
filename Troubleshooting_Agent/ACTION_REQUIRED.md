# ⚠️ ACTION REQUIRED: Fix Missing Database View

**Date:** 2026-02-11
**Priority:** 🔴 CRITICAL - Blocks pipeline creation
**Time Required:** 2 minutes

---

## What You Need to Do

You need to **run SQL in your Supabase dashboard** to create a missing database view.

### Quick Steps:

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project (zturojwgqtjrxwsfbwqw)

2. **Open SQL Editor**
   - Click **SQL Editor** in left sidebar
   - Click **New Query**

3. **Run This SQL**
   - Copy the contents of `HOTFIX_CREATE_VIEW_CORRECT.sql` (in this directory)
   - Or copy from below:

```sql
-- Create the view (CORRECTED VERSION)
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  s.name AS space_name,
  s.space_type AS space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;

-- Grant access
GRANT SELECT ON camera_intents_with_spaces TO authenticated;
GRANT SELECT ON camera_intents_with_spaces TO anon;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_camera_intents_pipeline_selected
ON camera_intents(pipeline_id) WHERE is_selected = TRUE;

CREATE INDEX IF NOT EXISTS idx_camera_intents_space_selected
ON camera_intents(space_id, is_selected) WHERE is_selected = TRUE;

-- Verify
SELECT 'View created successfully!' AS status;
```

4. **Click "Run"** (or press Ctrl+Enter)
   - Should see: `View created successfully!`

5. **Test**
   - Go back to your app
   - Try creating a new pipeline
   - Should work without 404 error

---

## Why This Is Needed

When you create a pipeline, the frontend immediately tries to query a database view called `camera_intents_with_spaces`. This view doesn't exist yet because the migration that creates it hasn't been applied to your database.

**Current Error:**
```
GET .../camera_intents_with_spaces 404 (Not Found)
Could not find the table 'public.camera_intents_with_spaces'
```

---

## What This Will Fix

✅ No more 404 errors when creating pipelines
✅ Frontend can query camera intents properly
✅ Pipeline creation works end-to-end

---

## Three Fixes Applied Today

| # | Issue | Status | Action |
|---|-------|--------|--------|
| **1** | Phase/step mismatch on creation | ✅ Fixed in code | None - auto applied |
| **2** | Phase transition Step 2→3 fails | ✅ Deployed | None - already deployed |
| **3** | Missing database view | ⚠️ **PENDING** | **YOU: Run SQL now** |

---

## After Running the SQL

Once you've run the SQL, you should be able to:
- ✅ Create new pipelines without errors
- ✅ Advance from Step 2 to Step 3 without errors
- ✅ Complete full pipeline flow

---

## Need Help?

If you get an error when running the SQL:

1. **Check if view already exists:**
   ```sql
   SELECT * FROM camera_intents_with_spaces LIMIT 1;
   ```
   - If this works, the view already exists - you're good!

2. **Check if base table exists:**
   ```sql
   SELECT * FROM camera_intents LIMIT 1;
   ```
   - If this fails, you need to apply more migrations

3. **Report back:**
   - Copy the exact error message
   - Report what happened

---

## Documentation

- **Full details:** `VIEW_CREATION_FIX.md`
- **SQL file:** `HOTFIX_CREATE_VIEW.sql`
- **All bugs summary:** `PHASE_STEP_BUGS_SUMMARY.md`

---

## TL;DR

**Do this now:**
1. Open Supabase dashboard → SQL Editor
2. Run `HOTFIX_CREATE_VIEW.sql`
3. Test pipeline creation

**Expected:** Pipeline creation works, no 404 error.
