# 🚨 CRITICAL AGENT INSTRUCTIONS 🚨

## File Organization Rules

### Root Directory (KEEP MINIMAL)
**ONLY these files belong in root:**
1. **Core Memory Files (6 files):** `README.md`, `CLAUDE.md`, `task_plan.md`, `progress.md`, `findings.md`, `gemini.md`
2. **Build/Config Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, etc. (build tools require these in root)

**NEVER create new `.md` or `.sql` files in root!** Use the docs/ structure below.

### Documentation Structure (docs/)
All documentation, logs, and non-code artifacts go in **docs/** subdirectories:

- **docs/phases/** - Phase implementation documentation (PHASE_1, PHASE_2, etc.)
- **docs/features/** - Feature implementation guides (camera intents, QA systems, Langfuse, etc.)
- **docs/testing/** - Testing checklists, QA procedures, verification guides
- **docs/fixes/** - Bug fix summaries and repair documentation
- **docs/local-development/** - Local dev setup guides, quickstart instructions
- **docs/troubleshooting/** - Active debugging guides for known issues
- **docs/setup/** - One-time setup instructions for features
- **docs/sql/** - SQL utility scripts and database tools
- **docs/legacy/** - Completed/historical work (move here when work is done)

### Troubleshooting_Agent/ (ACTIVE MONITORING ONLY)
**This directory is for ACTIVE monitoring and critical reference ONLY:**
- Active migration logs (e.g., CLOUD_MIGRATION_LOG.md during 24-hour monitoring window)
- Critical rollback procedures (e.g., MIGRATION_COMPLETE_SUMMARY.md)
- Recent infrastructure changes (e.g., E2E_TEST_IMPLEMENTATION_COMPLETE.md)

**When monitoring is complete, move to docs/legacy/**

### Where to Put New Files

| What you're creating | Where it goes |
|---------------------|---------------|
| Phase documentation | `docs/phases/PHASE_N_*.md` |
| Feature implementation guide | `docs/features/FEATURE_NAME.md` |
| Bug fix summary | `docs/fixes/FIX_DESCRIPTION.md` |
| Testing/QA checklist | `docs/testing/TEST_TYPE_CHECKLIST.md` |
| Troubleshooting guide | `docs/troubleshooting/DEBUG_*.md` |
| Local dev instructions | `docs/local-development/SETUP_*.md` |
| SQL utility | `docs/sql/utility_name.sql` |
| Completed/old work | `docs/legacy/ORIGINAL_NAME.md` |
| Active monitoring (temporary) | `Troubleshooting_Agent/ACTIVE_LOG.md` → move to docs/ when done |

### Local Artifacts (NEVER COMMIT)
Put local-only files in `local_supabase/debug/`:
- Diagnostic reports
- Debug SQL scripts
- Test outputs
- Connection logs

These are gitignored and won't be committed.
