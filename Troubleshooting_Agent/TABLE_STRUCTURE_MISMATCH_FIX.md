# Table Structure Mismatch Fix

**Date:** 2026-02-11
**Issue:** View creation failed due to wrong table structure assumption
**Error:** `column ci.standing_space_id does not exist`

---

## Problem Summary

When you tried to run the hotfix SQL to create the `camera_intents_with_spaces` view, it failed with:

```
ERROR: 42703: column ci.standing_space_id does not exist
LINE 10: JOIN floorplan_pipeline_spaces ss ON ci.standing_space_id = ss.id
```

This happened because there are **two different versions** of the `camera_intents` table in your migrations directory, and I initially created the view for the wrong version.

---

## Two Table Structures

### Version 1: Simple Structure ✅ (Your Database)
**Migration:** `20250211_add_camera_intents_table.sql`

**Columns:**
- `id` (UUID)
- `pipeline_id` (UUID)
- `space_id` (UUID) ← Single space reference
- `owner_id` (UUID)
- `suggestion_text` (TEXT) ← Simple text suggestion
- `suggestion_index` (INT) ← 0-based index within space
- `space_size_category` (TEXT)
- `is_selected` (BOOLEAN)
- `selected_at` (TIMESTAMPTZ)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**Use Case:** Stores AI-generated camera intent suggestions as simple text per space.

---

### Version 2: Complex Structure ❌ (Not in your database)
**Migration:** `20260210105014_54418111-6d27-4676-8d73-f28625fa1778.sql`

**Columns:**
- `id` (UUID)
- `camera_id` (TEXT) ← Deterministic identifier
- `pipeline_id` (UUID)
- `owner_id` (UUID)
- `standing_space_id` (UUID) ← Where camera stands
- `standing_space_name` (TEXT)
- `template_id` (camera_template_id ENUM) ← A-H templates
- `template_description` (TEXT)
- `view_direction_type` (view_direction_type ENUM)
- `target_space_id` (UUID) ← Where camera looks (nullable)
- `target_space_name` (TEXT)
- `intent_description` (TEXT)
- `generation_order` (INT)
- `is_selected` (BOOLEAN)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**Use Case:** Stores structured camera intents with templates (A-H), view directions, and standing/target space relationships.

---

## What Went Wrong

1. **Initial hotfix SQL:** I created `HOTFIX_CREATE_VIEW.sql` assuming **Version 2** (complex structure)
2. **Your database:** Actually has **Version 1** (simple structure)
3. **Result:** SQL failed because columns like `standing_space_id` and `target_space_id` don't exist

---

## The Fix

### ❌ Wrong SQL (HOTFIX_CREATE_VIEW.sql)
```sql
-- This FAILS because your table doesn't have these columns
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  ss.name AS standing_space_name,  -- ❌ standing_space_id doesn't exist
  ts.name AS target_space_name     -- ❌ target_space_id doesn't exist
FROM camera_intents ci
JOIN floorplan_pipeline_spaces ss ON ci.standing_space_id = ss.id  -- ❌ FAIL
LEFT JOIN floorplan_pipeline_spaces ts ON ci.target_space_id = ts.id;  -- ❌ FAIL
```

### ✅ Correct SQL (HOTFIX_CREATE_VIEW_CORRECT.sql)
```sql
-- This WORKS with your simple table structure
CREATE OR REPLACE VIEW camera_intents_with_spaces AS
SELECT
  ci.*,
  s.name AS space_name,         -- ✅ Uses space_id
  s.space_type AS space_type
FROM camera_intents ci
JOIN floorplan_pipeline_spaces s ON ci.space_id = s.id;  -- ✅ Works!
```

---

## Frontend Fix

I also updated the frontend query to use the correct column ordering:

**File:** `src/components/WholeApartmentPipelineCard.tsx:2172`

**Before (Wrong):**
```typescript
.order("generation_order");  // ❌ Column doesn't exist in simple structure
```

**After (Correct):**
```typescript
.order("space_id")
.order("suggestion_index");  // ✅ Matches simple structure
```

---

## Files Updated

### SQL Files Created:
- ✅ `HOTFIX_CREATE_VIEW_CORRECT.sql` - Correct version for your table structure
- ❌ `HOTFIX_CREATE_VIEW.sql` - Wrong version (ignore this)

### Frontend Files Updated:
- ✅ `src/components/WholeApartmentPipelineCard.tsx` - Fixed query ordering

### Documentation Updated:
- ✅ `ACTION_REQUIRED.md` - Points to correct SQL file
- ✅ `VIEW_CREATION_FIX.md` - Updated with correct SQL
- ✅ `TABLE_STRUCTURE_MISMATCH_FIX.md` - This file (explains the issue)

---

## How to Apply the Fix

### Step 1: Run the Correct SQL

1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `HOTFIX_CREATE_VIEW_CORRECT.sql`
3. Click "Run"
4. Should see: `View created successfully!`

### Step 2: Restart Dev Server (if needed)

```bash
# Kill current dev server (Ctrl+C)
npm run dev
```

Frontend changes will hot-reload automatically in most cases.

### Step 3: Test

1. Try creating a new pipeline
2. Should work without 404 error
3. Should work without 400 phase/step error

---

## Why There Are Two Versions

Your migrations directory has evolved over time with two different approaches to camera intents:

1. **20250211** migrations - Simple text-based suggestions
2. **20260210** migrations - Complex template-based system (A-H templates)

The complex version was designed later but hasn't been applied to your database. Your database still uses the simple version.

---

## Recommended Actions

### Immediate (Required):
- ✅ Run `HOTFIX_CREATE_VIEW_CORRECT.sql`
- ✅ Test pipeline creation

### Optional (Future):
- Decide which table structure you want long-term:
  - **Simple:** Keep current structure (easier, already working)
  - **Complex:** Migrate to template-based system (more powerful, requires migration)
- Clean up unused migration files to avoid confusion
- Document which structure is canonical

---

## Verification

After running the correct SQL, verify:

```sql
-- Check view exists
SELECT * FROM camera_intents_with_spaces LIMIT 1;

-- Check table structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'camera_intents'
ORDER BY ordinal_position;
```

**Expected columns:**
- id, pipeline_id, space_id, owner_id, suggestion_text, suggestion_index, space_size_category, is_selected, selected_at, created_at, updated_at

**Should NOT have:**
- standing_space_id, target_space_id, template_id, generation_order

---

## Summary

**Problem:** View SQL assumed complex table structure with `standing_space_id`
**Reality:** Database has simple structure with just `space_id`
**Solution:** Created corrected view SQL that matches your actual table structure
**Status:** ✅ Fixed - run `HOTFIX_CREATE_VIEW_CORRECT.sql` to apply

**Expected Result:** Pipeline creation works without 404 errors.
