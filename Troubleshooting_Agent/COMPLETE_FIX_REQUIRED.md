# 🔴 COMPLETE DATABASE FIX REQUIRED

**Date:** 2026-02-11
**Priority:** CRITICAL - Multiple migrations not applied
**Time Required:** 5 minutes

---

## The Real Problem

Your database is missing MULTIPLE critical migrations, not just the view. This is why you're seeing the error:

**Error:** `Phase camera_intent_pending expects step 4 but current_step is 3`

**Root Cause:** The `20250211` migrations (4 files) haven't been applied to your database, which means:
1. ❌ Missing phase enum values (`camera_intent_pending`, `prompt_templates_pending`, etc.)
2. ❌ Missing/outdated phase-step consistency trigger
3. ❌ Missing `camera_intents_with_spaces` view
4. ❌ Existing pipelines may have mismatched phase/step values

---

## ⚡ COMPLETE FIX - Run This SQL

I've created a comprehensive hotfix that applies ALL the missing pieces.

### Step 1: Open Supabase Dashboard

1. Go to: https://supabase.com/dashboard
2. Select your project (zturojwgqtjrxwsfbwqw)
3. Click **SQL Editor** in left sidebar
4. Click **New Query**

### Step 2: Run Complete Hotfix

Copy the entire contents of `HOTFIX_COMPLETE_SETUP.sql` and paste it into the SQL editor.

Or copy this:

```sql
-- [See HOTFIX_COMPLETE_SETUP.sql for the complete SQL]
-- The file is too long to include here, but it contains:
-- 1. Add missing phase enum values
-- 2. Drop old trigger and create updated version
-- 3. Create camera_intents_with_spaces view
-- 4. Add performance indexes
-- 5. Fix any existing pipelines with mismatched phase/step
```

### Step 3: Click "Run" (Ctrl+Enter)

**Expected output:**
```
status: All fixes applied successfully!
part1: Phase enum values added
part2: Trigger created
part3: View created
part4: Indexes created
part5: Existing pipelines fixed
```

---

## What This Fixes

| Issue | Before | After |
|-------|--------|-------|
| **Missing phases** | `camera_intent_pending` doesn't exist | ✅ All phases added |
| **Phase/step mismatch** | Trigger outdated or missing | ✅ Updated trigger enforces consistency |
| **404 error** | View doesn't exist | ✅ View created |
| **400 errors** | Inconsistent phase/step | ✅ All pipelines fixed |
| **Broken pipelines** | Old pipelines stuck | ✅ Migrated to new structure |

---

## Why Previous Fixes Weren't Enough

**Attempt #1:** Create just the view → Failed because phase values don't exist
**Attempt #2:** Use corrected view SQL → Still failed because migrations not applied
**Attempt #3 (THIS ONE):** Apply ALL missing migrations at once → Should work!

---

## What the SQL Does

### Part 1: Add Phase Enum Values
Adds all new phase values to the `whole_apartment_phase` enum:
- `camera_intent_pending`, `camera_intent_confirmed`
- `prompt_templates_pending`, `prompt_templates_confirmed`
- `outputs_pending`, `outputs_in_progress`, `outputs_review`

### Part 2: Update Phase-Step Trigger
Creates a database trigger that:
- Auto-populates `current_step` based on phase
- Validates phase/step consistency
- Prevents mismatched updates

### Part 3: Create View
Creates `camera_intents_with_spaces` view with correct table structure.

### Part 4: Add Indexes
Creates performance indexes for fast queries.

### Part 5: Fix Existing Pipelines
Updates any existing pipelines to have consistent phase/step values.

---

## After Running the SQL

### Test Immediately:
1. Hard refresh your app (Ctrl+F5)
2. Try creating a new pipeline
3. Should work without ANY errors

### Expected Results:
- ✅ No 400 Bad Request (phase/step mismatch)
- ✅ No 404 Not Found (missing view)
- ✅ Pipeline created successfully
- ✅ Can advance from Step 2 → Step 3
- ✅ Can advance through all steps

---

## Verification Queries

After running the hotfix, verify everything is set up:

```sql
-- 1. Check phase enum values exist
SELECT unnest(enum_range(NULL::whole_apartment_phase)) AS phase_values;
-- Should include: camera_intent_pending, prompt_templates_pending, outputs_pending

-- 2. Check trigger exists
SELECT tgname FROM pg_trigger WHERE tgname = 'enforce_phase_step_consistency';
-- Should return: enforce_phase_step_consistency

-- 3. Check view exists
SELECT * FROM camera_intents_with_spaces LIMIT 1;
-- Should work (may return 0 rows if no data)

-- 4. Check pipelines are consistent
SELECT id, whole_apartment_phase, current_step
FROM floorplan_pipelines
WHERE whole_apartment_phase IS NOT NULL
LIMIT 5;
-- All phase/step combinations should be valid
```

---

## If It Still Fails

If you still get errors after running the complete SQL:

1. **Check the error message:**
   - Copy the exact error from browser console
   - Check what phase and step values it mentions

2. **Verify SQL ran successfully:**
   - Did you see the success message with all 5 parts?
   - Run the verification queries above

3. **Check for other issues:**
   - Clear browser cache (Ctrl+F5)
   - Check Supabase logs for additional errors
   - Look for any other error messages in console

4. **Report back with:**
   - Exact error message
   - Results of verification queries
   - Any other console errors

---

## Related Files

**Complete Fix:**
- `HOTFIX_COMPLETE_SETUP.sql` - Run this in Supabase dashboard

**Individual Fixes (Outdated - Don't use these):**
- ❌ `HOTFIX_CREATE_VIEW.sql` - Wrong structure
- ❌ `HOTFIX_CREATE_VIEW_CORRECT.sql` - Only partial fix

**Documentation:**
- `COMPLETE_FIX_REQUIRED.md` - This file
- `PHASE_STEP_BUGS_SUMMARY.md` - Overview of all bugs
- `ACTION_REQUIRED.md` - Outdated (use this file instead)

---

## Summary

**What went wrong:** 4 critical migrations from `20250211` were never applied to your database.

**What to do:** Run `HOTFIX_COMPLETE_SETUP.sql` in Supabase dashboard.

**Expected result:** Pipeline creation and advancement works perfectly with no errors.

**Time required:** 5 minutes (2 min to run SQL, 3 min to test)

---

## TL;DR

1. Open Supabase dashboard → SQL Editor
2. Paste entire contents of `HOTFIX_COMPLETE_SETUP.sql`
3. Click "Run"
4. See success message
5. Test pipeline creation
6. Everything should work!

---

**DO THIS NOW - All three previous bugs plus migration issues will be fixed in one go!**
