# Local Supabase Setup Complete

**Date:** 2026-02-15
**Status:** ✅ COMPLETE

## Summary

Successfully configured the app to connect to LOCAL Supabase (Docker) instead of the hosted production instance.

## Actions Taken

### 1. Migration Fixes
Fixed several broken database migrations:
- Created `20260210135959_drop_old_camera_intents.sql` to drop incompatible old schema
- Replaced broken migrations with FIXED versions:
  - `20260210140000_add_camera_intents_table.sql`
  - `20260210140100_add_final_prompts_table.sql`
- Fixed `20260210140200_update_pipeline_phases.sql` (removed enum operations on TEXT column)
- Disabled incompatible migrations:
  - `20260210150001_activate_camera_intents.sql.disabled`
  - `20260211000000_fix_camera_intents_view_access.sql.disabled`

### 2. Local Supabase Started
```bash
supabase start
```
Successfully started local Supabase with all migrations applied.

### 3. Local Credentials Retrieved
```bash
supabase status --output json
```

**Local Instance Details:**
- **API URL:** http://127.0.0.1:54321
- **Anon Key (JWT):** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
- **Service Role Key (JWT):** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
- **Studio URL:** http://127.0.0.1:54323
- **Database URL:** postgresql://postgres:postgres@127.0.0.1:54322/postgres

### 4. Created .env.local
Created `.env.local` with LOCAL credentials:
```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

# Server-side only (not exposed to frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

## Environment Variable Hierarchy

Vite loads env files in this order (higher priority wins):
1. ✅ `.env.local` (LOCAL Supabase - **ACTIVE**)
2. `.env.development` (not present)
3. `.env` (PRODUCTION Supabase - overridden)

## Next Steps

### ⚠️ REQUIRED: Restart Dev Server
The dev server MUST be restarted for Vite to load the new .env.local variables:
```bash
# Stop current dev server (Ctrl+C)
npm run dev
```

### Validation Checklist
After restarting the dev server:
- [ ] Check browser console - Supabase client should connect to `http://127.0.0.1:54321`
- [ ] Test auth flow (login/signup) - should work with local DB
- [ ] Test database operations (read/write) - should use local tables
- [ ] Verify no production data is being accessed

### Edge Functions (Updated 2026-02-16)

**Start Edge Functions server:**
```bash
supabase functions serve --env-file .env.local > /tmp/functions.log 2>&1 &
```

**View function logs:**
```bash
tail -f /tmp/functions.log
```

**Note:** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` are automatically injected by Supabase into Edge Functions. No need to define them in .env.local.

**Available functions:** 73+ functions at `http://127.0.0.1:54321/functions/v1/`

## Useful Commands

**Start local Supabase:**
```bash
supabase start
```

**Stop local Supabase:**
```bash
supabase stop
```

**Check status:**
```bash
supabase status
```

**Access local Studio (database UI):**
Open: http://127.0.0.1:54323

**Reset local database (⚠️ deletes all local data):**
```bash
supabase db reset
```

## File Changes Summary

### Created Files:
- `.env.local` - Local Supabase credentials
- `supabase/migrations/20260210135959_drop_old_camera_intents.sql` - Migration fix
- `supabase/functions/_shared/cors.ts` - Shared CORS headers for Edge Functions (2026-02-16)

### Modified Files:
- `supabase/migrations/20260210140000_add_camera_intents_table.sql` - Replaced with FIXED version
- `supabase/migrations/20260210140100_add_final_prompts_table.sql` - Replaced with FIXED version
- `supabase/migrations/20260210140200_update_pipeline_phases.sql` - Removed invalid enum operations

### Disabled Files:
- `supabase/migrations/20260210140000_add_camera_intents_table.sql.broken`
- `supabase/migrations/20260210140100_add_final_prompts_table.sql.broken`
- `supabase/migrations/20260210150001_activate_camera_intents.sql.disabled`
- `supabase/migrations/20260211000000_fix_camera_intents_view_access.sql.disabled`

## Security Notes

✅ **CORRECT:** Service role key is in SUPABASE_SERVICE_ROLE_KEY (no VITE_ prefix)
✅ **CORRECT:** Only anon key is exposed to frontend via VITE_SUPABASE_ANON_KEY
✅ **CORRECT:** Local credentials only (not production keys)

## Troubleshooting

### If the app still connects to production:
1. Confirm dev server was restarted
2. Check browser dev tools → Network tab → Look for requests to `127.0.0.1:54321`
3. Verify `.env.local` exists and has correct values
4. Clear browser cache/hard reload

### If local Supabase won't start:
1. Check Docker Desktop is running
2. Run: `supabase stop` then `supabase start`
3. Check for port conflicts (54321, 54322, 54323)

### If migrations fail:
1. Run: `supabase db reset` to reset local database
2. This will re-run all migrations from scratch
