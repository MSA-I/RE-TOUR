# Memory: pipeline/camera-planning-draft-lifecycle
Updated: now

Camera Planning data follows a draft-to-finalized lifecycle:

1. **Draft State** (default): Camera markers, screenshots, and scan artifacts persist across page refreshes in `pipeline_camera_markers` and related tables. The UI shows an amber "Draft — Persisted" badge. All edits are saved immediately to the server.

2. **Approved State**: When the user clicks "Confirm Camera Plan", the `confirm-camera-plan` edge function sets `camera_plan_confirmed_at` on the pipeline. The UI shows a green "Approved — Editable" badge. Users can still edit and re-confirm.

3. **Locked State**: Once renders start (phase >= Step 5), camera planning becomes immutable. The UI shows a blue "Locked" badge and the editor cannot be opened.

4. **Reset Behavior**: The `reset-floorplan-pipeline` function clears `camera_plan_confirmed_at` along with all other pipeline state, reverting the camera plan to draft status.

Key invariants:
- Data NEVER exists only in UI memory; all changes persist server-side immediately
- Draft data survives page refresh, tab switching, and browser restart
- Finalization occurs ONLY via explicit user action ("Confirm Camera Plan")
- Editing is blocked ONLY after renders have started (committed), not just after approval
