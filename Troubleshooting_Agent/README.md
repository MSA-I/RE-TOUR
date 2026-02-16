# Troubleshooting_Agent Directory

## Purpose
This directory is for **ACTIVE monitoring and critical reference ONLY**.

## What Belongs Here
- ✅ Active migration logs during monitoring windows (e.g., `CLOUD_MIGRATION_LOG.md` during 24-hour watch)
- ✅ Critical rollback procedures for ongoing deployments
- ✅ Recent infrastructure changes that need team awareness
- ✅ Temporary status files that will be moved to `docs/` when complete

## What Does NOT Belong Here
- ❌ Completed bug fixes → `docs/fixes/`
- ❌ Feature implementation guides → `docs/features/`
- ❌ Testing checklists → `docs/testing/`
- ❌ Troubleshooting guides → `docs/troubleshooting/`
- ❌ Phase documentation → `docs/phases/`
- ❌ Any file older than 1 week → `docs/legacy/`

## Current Files (as of 2026-02-16)
- `CLOUD_MIGRATION_LOG.md` - Active 24-hour monitoring window for cloud migration
- `E2E_TEST_IMPLEMENTATION_COMPLETE.md` - Recent E2E test infrastructure changes
- `MIGRATION_COMPLETE_SUMMARY.md` - Rollback procedures for recent migration

## Workflow
1. **Create** file here if it's for active monitoring
2. **Update** regularly during active phase
3. **Move** to appropriate `docs/` subdirectory when monitoring complete
4. **Keep this directory lean** (target: <5 files at any time)

## Why This Structure?
This directory acts as a **"hot files" workspace** for agents working on urgent issues. Once the urgency passes, files move to permanent homes in `docs/`.

Think of it as your **"Current Tasks" folder** vs the **"Filing Cabinet"** (docs/).

---

For all new documentation, see `docs/README.md` for the complete filing structure.
