# Memory: pipeline/step5-idempotency-and-deduplication
Updated: now

Step 5 (Space Rendering) implements strict idempotency and deduplication controls to prevent duplicate Camera A outputs.

## Idempotency Key

The idempotency key for Step 5 renders is: `(pipeline_id, space_id, camera_kind, step=5)`.

## Deduplication Logic in run-space-render

Before starting generation, the edge function checks:

1. **Same render status check**: If the requested render_id is already in `generating`, `running`, or `queued` status, return immediately with `idempotent: true` response.

2. **Duplicate render check**: Query for any OTHER renders for the same `(space_id, kind)` combination that are in progress. If found, return HTTP 409 with `DUPLICATE_IN_PROGRESS` error.

```typescript
const IN_PROGRESS_STATUSES = ["generating", "running", "queued"];

// Check if this render is already in progress
if (IN_PROGRESS_STATUSES.includes(render.status)) {
  return { success: true, idempotent: true, message: "Render already in progress" };
}

// Check for other in-progress renders for same space/kind
const { data: duplicates } = await supabase
  .from("floorplan_space_renders")
  .select("id, status")
  .eq("space_id", render.space_id)
  .eq("kind", render.kind)
  .in("status", IN_PROGRESS_STATUSES)
  .neq("id", render_id);

if (duplicates?.length > 0) {
  return { error: "DUPLICATE_IN_PROGRESS", status: 409 };
}
```

## Request Tracing

Every Step 5 request includes a unique `requestId` for terminal log tracing:

```
[space-render][abc12345] Request received: render_id=xxx, step=5
[space-render][abc12345] Starting generation for render xxx (A) space=yyy
```

## Camera A→B Sequential Chain

- Camera A must complete and be approved before Camera B starts
- Camera B generation is blocked with `CAMERA_A_DEPENDENCY_REQUIRED` if Camera A output is missing
- The batch-renders edge function enforces this by processing A first, then B only after A succeeds
