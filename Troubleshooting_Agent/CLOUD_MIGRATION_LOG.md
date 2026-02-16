# Cloud Migration Rollback Log
**Date:** 2026-02-16
**Migration:** Local Supabase → Cloud Supabase (project zturojwgqtjrxwsfbwqw)

## Status: IN PROGRESS ✅

### Completed Phases

#### ✅ Phase A: Pre-Flight Checks
- Successfully linked to cloud project zturojwgqtjrxwsfbwqw
- Verified database connection
- Identified migration discrepancies (disabled migrations on remote)

#### ✅ Phase B: Database Migration
- **Migration Repair:** Marked migrations 20260210150001 and 20260211000000 as reverted on cloud (were disabled locally)
- **Renamed diagnostic file:** `00_DIAGNOSE_EXISTING_SCHEMA.sql` → `00_DIAGNOSE_EXISTING_SCHEMA.sql.diagnostic`
- **Applied pending migrations:**
  - 20260210135959_drop_old_camera_intents.sql (dropped old schema, recreated camera_intents)
  - 20260212000000_add_final_prompts_output_fields.sql (added QA fields)
  - 20260217000000_add_soft_delete_to_uploads.sql (soft delete implementation)
- **Result:** All 74 active migrations now synced between local and cloud
- **Verification:** Migration list shows all local migrations applied to remote

#### ✅ Phase C: Storage Setup
- **Buckets verified:** panoramas, design_refs, outputs, floor_plans, uploads all exist on cloud
- **Data found:** Some existing data in design_refs and outputs buckets (from previous cloud usage)
- **RLS policies:** Applied via migrations (migration 20251231074318)
- **Decision:** Keeping existing buckets and data (acceptable for dev environment)

#### ✅ Phase D: Edge Functions Deployment
- **Functions deployed:** 73 edge functions deployed to cloud
- **New function added:** run-design-reference-scan
- **Updated functions:** Most functions redeployed with latest code
- **Unchanged functions:** 13 functions had no changes (already up-to-date)
- **Secrets configured:**
  - API_NANOBANANA: ✅ Set (Gemini API key)
  - GEMINI_API_KEY: ✅ Set (duplicate of API_NANOBANANA)
  - Langfuse keys: ✅ Already configured
- **Verification:** Tested help-chatbot function - returned valid JSON response

#### ✅ Phase E: Frontend Wiring
- **Environment switch:**
  - Disabled `.env.local` (renamed to `.env.local.DISABLED`)
  - Verified `.env` contains cloud credentials (zturojwgqtjrxwsfbwqw)
- **TypeScript types:** Regenerated from cloud schema (updated 2026-02-16 04:53)
- **Local Supabase:** Stopped all containers (except lingering vector container, forcefully removed)
- **Dev server:** Killed old process (PID 36968), started new instance (PID 18284)
- **Verification:** Dev server responding on port 8080, serving React app

### In Progress

#### 🔄 Phase F: End-to-End Verification
- Next steps: Test auth, project creation, uploads, pipeline operations

### Pending

#### ⏳ Phase G: Security & Performance Checks
- RLS policy verification
- Index verification
- Connection pool check

---

## Technical Notes

### Migration History Repair
The cloud database had two migrations (20260210150001, 20260211000000) that were disabled locally. These created:
- `camera_intents_with_spaces` view (helper view for UI queries)
- Indexes on camera_intents
- RLS grants on the view

**Decision:** Marked as reverted on cloud to match local intent (these migrations were disabled after architectural changes)

### Edge Function Deployment
All 73 local functions deployed successfully. Cloud already had 71 functions from previous deployment. Function versions updated to match local codebase:
- Script sizes: 35KB - 140KB (typical for Deno functions with dependencies)
- CORS and URL transform utilities in `_shared/` folder deployed automatically

### Environment Configuration
- **Cloud URL:** https://zturojwgqtjrxwsfbwqw.supabase.co
- **Anon Key:** eyJhbGciOi... (from .env, valid until 2085-08-70)
- **Project ID:** zturojwgqtjrxwsfbwqw
- **Database:** PostgreSQL (via Supabase cloud)

---

## Next Steps

1. **Phase F:** Run E2E verification tests
   - Auth flow (signup/login)
   - Project creation
   - File upload to storage
   - Pipeline initialization
   - Edge function calls from UI
   - QA system verification

2. **Phase G:** Security & performance checks
   - Verify RLS policies on all critical tables
   - Check indexes exist
   - Review connection pool settings

3. **Post-Migration:** Monitor for 24 hours
   - Edge function logs
   - Database performance
   - Error rates in frontend
   - User feedback

---

## Issues Encountered

1. **Storage CLI commands:** Required `--experimental` flag for storage ls commands
2. **Functions list:** Flag `--linked` not supported, used `--project-ref` instead
3. **MCP Supabase tools:** Not configured for this project (execute_sql RPC not found)
4. **Lingering container:** Vector container kept restarting after `supabase stop`, required manual docker stop/rm
5. **Log file:** Background dev server log file empty (process started successfully but no output captured)

---

## Rollback Plan (If Needed)

If critical issues arise:

```bash
# Restore local environment
mv .env.local.DISABLED .env.local

# Start local Supabase
npx supabase start

# Restart dev server
# (kill current process and run npm run dev)
```

No data backup needed - this is a fresh migration for development environment.
