# Memory: ui/camera-planning-single-scroll
Updated: now

The Camera Planning panel has been refactored to use a single scroll container for all its content, including the map, layers, and AI Scan section. Nested scroll areas that previously trapped the mouse wheel have been removed or reconfigured to prevent scroll chaining to the background page. A "Jump to AI Scan" button is available for quick navigation within the panel.

## Resizable Panel Feature (Added)

The side panel now supports:
- **Drag resize**: A vertical resize handle on the left edge allows width adjustment (320px - 620px)
- **Collapse/Expand**: Toggle button in header to collapse to a 48px rail or expand back
- **Width persistence**: Panel width is saved to localStorage (`cameraPlanningPanelWidth`)
- **Overflow protection**: All content uses `min-w-0`, `truncate`, and proper flex constraints to prevent overflow

## Panel Width Constants
- `PANEL_MIN_WIDTH`: 320px
- `PANEL_DEFAULT_WIDTH`: 420px  
- `PANEL_MAX_WIDTH`: 620px
- `PANEL_COLLAPSED_WIDTH`: 48px

## Initialization Guard for Scan Invalidation (Added)

To prevent false-positive scan invalidation on re-edit (which was deleting screenshots):
- **`isInitializingRef`**: A ref that stays `true` during initial component hydration
- **`initTimeoutRef`**: Debounce timer that sets `isInitializingRef = false` after markers stabilize (500ms)
- **Gated invalidation**: The `invalidateScan.mutate()` call only fires if:
  1. `isInitializingRef.current === false` (past initialization)
  2. `prevMarkersHashRef.current !== markersHash` (markers actually changed)
  3. `scanStatus === "completed"` (scan was previously completed)
- This ensures re-opening the editor does NOT trigger cleanup of existing scan artifacts
