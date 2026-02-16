# Phase 1: Database Migration Guide

## Overview
Phase 1 is CRITICAL - all other phases depend on these database changes being applied first.

## Migration Files to Apply
All migration files exist in `supabase/migrations/` and must be applied in this order:

### 1. Camera Intents Table
**File**: `20260210140000_add_camera_intents_table.sql`
- Creates `camera_intents` table for storing AI-generated camera intent suggestions
- Adds RLS policies
- Creates indexes for performance

### 2. Final Prompts Table
**File**: `20260210140100_add_final_prompts_table.sql`
- Creates `final_prompts` table for storing final composed prompts
- Tracks NanoBanana job execution
- Adds RLS policies

### 3. Update Pipeline Phases
**File**: `20260210140200_update_pipeline_phases.sql`
- Adds new enum values to `whole_apartment_phase`:
  - `camera_intent_pending`
  - `camera_intent_confirmed`
  - `prompt_templates_pending`
  - `prompt_templates_confirmed`
  - `outputs_pending`
  - `outputs_in_progress`
  - `outputs_review`
- Migrates existing pipelines from old phase names to new ones

### 4. Update Phase-Step Constraint
**File**: `20260210140300_update_phase_step_constraint.sql`
- Updates database trigger to enforce new phase-step mappings
- Includes Steps 4, 5, 6 in the constraint validation

## How to Apply Migrations

### Option A: Using Supabase CLI (Recommended)

1. **Set your DATABASE_URL environment variable**:
```bash
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres"
```

2. **Apply migrations**:
```bash
cd A:\RE-TOUR
supabase db push --db-url "$DATABASE_URL"
```

### Option B: Using Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Copy and paste each migration file content **in order**
4. Execute each migration by clicking "Run"
5. Verify no errors after each migration

### Option C: Using Supabase MCP (if configured)

If you have the Supabase MCP server configured with proper credentials:

```typescript
await mcp.supabase.apply_migration({
  version: "20260210140000",
  sql: "...", // content of migration file
  name: "add_camera_intents_table"
});
```

## Verification After Applying

Run these SQL queries in Supabase SQL Editor to verify:

### 1. Verify camera_intents table exists
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'camera_intents'
ORDER BY ordinal_position;
```

**Expected**: 12 columns including id, pipeline_id, space_id, suggestion_text, is_selected, etc.

### 2. Verify final_prompts table exists
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'final_prompts'
ORDER BY ordinal_position;
```

**Expected**: 13 columns including id, pipeline_id, prompt_template, final_composed_prompt, nanobanana_job_id, etc.

### 3. Verify all new enum values exist
```sql
SELECT e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
ORDER BY e.enumsortorder;
```

**Expected**: Should include all 7 new phase values listed above.

### 4. Verify phase-step constraint trigger exists
```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'enforce_phase_step_consistency';
```

**Expected**: 1 row with trigger enabled.

### 5. Test phase-step validation
```sql
-- This should SUCCEED (valid phase-step pair)
UPDATE floorplan_pipelines
SET whole_apartment_phase = 'camera_intent_pending', current_step = 4
WHERE id = (SELECT id FROM floorplan_pipelines LIMIT 1);

-- This should FAIL (invalid phase-step pair)
UPDATE floorplan_pipelines
SET whole_apartment_phase = 'camera_intent_pending', current_step = 2
WHERE id = (SELECT id FROM floorplan_pipelines LIMIT 1);
```

## Troubleshooting

### Error: "type already exists"
If you get enum value already exists errors, it's safe - the migration uses `IF NOT EXISTS`.

### Error: "relation already exists"
If tables already exist, check if they have the correct schema by running the verification queries.

### Error: "duplicate key value"
If updating existing pipelines fails due to duplicates, check for data inconsistencies first.

## Phase 1 Complete Checklist
- [ ] All 4 migrations applied successfully
- [ ] camera_intents table exists with correct schema
- [ ] final_prompts table exists with correct schema
- [ ] All 7 new enum values exist in whole_apartment_phase
- [ ] Trigger enforce_phase_step_consistency is active
- [ ] Test UPDATE confirms trigger is working
- [ ] No errors in Supabase logs

## Next Steps
Once Phase 1 is complete, proceed to Phase 2 (Backend Edge Functions) which I'll implement next.

## Status: ⏳ PENDING USER ACTION
**Action Required**: User must apply these migrations via one of the methods above before proceeding with other phases.
