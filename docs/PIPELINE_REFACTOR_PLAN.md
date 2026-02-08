# PIPELINE REFACTOR: Implementation Plan

## Overview

This document outlines the step-by-step migration from the monolithic `run-pipeline-step` to a 4-service architecture that prevents WORKER_LIMIT errors, enforces payload control, and ensures reliability for architects/engineers.

## Architecture Summary

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Image I/O      │────▶│  Info Worker    │────▶│  Comparison     │────▶│  Supervisor     │
│  Service        │     │  (LLM Vision)   │     │  Worker         │     │  (Always-On)    │
│  (Deterministic)│     │                 │     │  (LLM + Rules)  │     │  (LLM Audit)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
   Signed URLs              Spaces JSON              PASS/FAIL             DECISION
   + Metadata               + Confidence             + Fixes               + Next Step
```

## Database Tables Created

### 1. `pipeline_jobs` - Queued Execution
```sql
- id, run_id, step_id, service
- status: pending | running | completed | failed | blocked
- attempts, max_attempts (bounded retries)
- payload_ref: JSONB (artifact IDs only, NO blobs)
- result_ref: JSONB (output artifact IDs)
- idempotency_key: Prevents duplicate runs
- locked_at, locked_by: Distributed locking
- last_error, last_error_stack: Observability
```

### 2. `pipeline_artifacts` - Storage References
```sql
- id, run_id, step_id, kind
- upload_id: Links to uploads table
- storage_bucket, storage_path
- signed_url_cached, signed_url_expires_at
- metadata_json: Dimensions, hash, quality
```

### 3. `pipeline_decisions` - Supervisor Audit Trail
```sql
- id, run_id, job_id, step_id
- decision: proceed | retry | block
- schema_validations: JSONB array
- rule_checks: JSONB array
- llm_audit: JSONB (consistency score, contradictions)
- retry_budget_remaining
- block_reason
```

### 4. `pipeline_runs` - Extended
```sql
- ratio, ratio_locked
- quality_post_step4
- payload_size_estimate
- last_error_stack
```

## Edge Functions Created

| Function | Purpose | Input | Output |
|----------|---------|-------|--------|
| `image-io-service` | URL signing, metadata | upload_ids | Signed URLs + metadata |
| `run-info-worker` | LLM vision analysis | artifact_ids | Spaces JSON |
| `run-comparison-worker` | Validate vs request | info_artifact_id + user_request | PASS/FAIL + failures + fixes |
| `run-supervisor` | Orchestrate, audit | job_id | Decision + next step |

## Comparison Worker Details

The Comparison Worker validates AI outputs against:
1. **Schema validation** - Validates Info Worker output against strict JSON schema
2. **Deterministic rules** - Space count, confidence thresholds, furnishing requirements
3. **LLM comparison** - Semantic comparison against user request (when provided)
4. **Severity assessment** - Classifies failures as low/medium/high/critical

### Validation Rules
- Min 2 spaces for floor plans
- Max 50% low-confidence spaces
- Max 30% ambiguous spaces
- Habitable rooms must have furnishings
- Critical spaces (bathroom, bedroom, kitchen) checked for residential plans

### Decision Logic
- Critical failures → `block_for_human`
- >5 failures → `block_for_human`
- >2 high failures → `retry_info`
- Any high failures → `retry_info`
- Otherwise → `proceed`
| `run-supervisor` | Orchestrate, audit | job_id | Decision + next step |

## Migration Phases

### Phase 1: Parallel Operation (Current)
- New services deployed alongside existing `run-pipeline-step`
- No breaking changes to existing flow
- Test new services independently

### Phase 2: Gradual Routing
- Route Step 0 (Space Analysis) through new services
- Keep Steps 1-6 on old path
- Validate payload sizes

### Phase 3: Full Migration
- Route all steps through new services
- Deprecate heavy paths in `run-pipeline-step`
- Monitor for WORKER_LIMIT errors

### Phase 4: Cleanup
- Remove unused code from `run-pipeline-step`
- Archive old approach
- Update documentation

## Key Rules Enforced

### Payload Control
✅ Frontend sends ONLY IDs (run_id, step_id, artifact_ids)
✅ All images referenced by signed URLs
✅ Never attach "all creations" to any request
✅ No base64 anywhere in request/response

### Deduplication / Locking
✅ `acquire_job_lock()` function with atomic update
✅ Job status check before starting
✅ Idempotency keys for each job
✅ Lock expiry (5 min) for crashed functions

### Quality Policy
✅ Steps 0-3: ALWAYS 2K (server-side enforcement)
✅ Steps 4+: User preference from `pipeline_runs.quality_post_step4`
✅ Dimension validation before storage

### Observability
✅ `processing_time_ms` tracked per job
✅ `last_error` + `last_error_stack` stored
✅ Structured logs with run_id, step_id, instance_id
✅ Supervisor decisions stored in `pipeline_decisions`

## Manual QA Checklist

### Test 1: Payload Size
```bash
# Check request size (should be < 10KB)
curl -X POST .../run-info-worker -d '{"run_id":"...", "artifact_ids":["..."]}' | wc -c
```

### Test 2: No WORKER_LIMIT
1. Start a pipeline with 4K quality
2. Complete all 7 steps
3. Verify no 546 errors in logs

### Test 3: Deduplication
1. Click "Generate" twice rapidly
2. Verify only one job runs
3. Check idempotency_key in pipeline_jobs

### Test 4: Locking
1. Start a job
2. Simulate crash (kill function)
3. Restart after 5 minutes
4. Verify lock is released

### Test 5: Supervisor Audit
1. Complete any step
2. Check `pipeline_decisions` table
3. Verify `llm_audit` has consistency_score
4. Verify decision matches expected outcome

## Acceptance Criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Payload Size | Request body size | < 50KB |
| WORKER_LIMIT | Error count | 0 |
| Duplicate Jobs | Concurrent duplicates | 0 |
| Retry Budget | Max attempts per step | 3 |
| LLM Audit | Consistency score tracking | 100% |
| Processing Time | P95 per step | < 60s |

## Rollback Plan

If issues occur:
1. Set feature flag `USE_NEW_PIPELINE = false`
2. Route all requests to `run-pipeline-step`
3. Investigate logs in `pipeline_jobs`
4. Fix and re-deploy

## Files Reference

### Schemas & Validation
- `supabase/functions/_shared/pipeline-schemas.ts`
- `supabase/functions/_shared/schema-validator.ts`
- `supabase/functions/_shared/quality-policy.ts`

### Edge Functions
- `supabase/functions/image-io-service/index.ts`
- `supabase/functions/run-info-worker/index.ts`
- `supabase/functions/run-comparison-worker/index.ts`
- `supabase/functions/run-supervisor/index.ts`

### Frontend Hook
- `src/hooks/useImageIO.ts`
