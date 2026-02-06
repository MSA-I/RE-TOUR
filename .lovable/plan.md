
# Plan: Fix Mouse Wheel Behavior in Plan/Image Viewer

## Problem Analysis

The `SourcePlanViewer` component uses React's `onWheel` handler:

```typescript
const handleWheel = useCallback((e: React.WheelEvent) => {
  e.preventDefault();  // ← DOES NOT WORK - React onWheel is passive!
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  setZoom(z => Math.max(0.5, Math.min(3, z + delta)));
}, []);
```

**Why it fails:**
- Modern browsers treat wheel event listeners as passive by default for performance
- React's `onWheel` prop registers a passive listener
- When a listener is passive, `e.preventDefault()` is ignored
- Result: The page scrolls while the zoom also changes

## Solution

Replace React's `onWheel` with native `addEventListener` using `{ passive: false }`.

---

## Implementation Details

### File: `src/components/whole-apartment/SourcePlanViewer.tsx`

#### 1. Add Native Wheel Event Listener for Inline Viewer

After the existing `useRef` declarations, add a `useEffect` hook:

```typescript
// Native wheel handler with passive: false - MANDATORY for preventDefault to work
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  
  const nativeWheelHandler = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.5, Math.min(3, z + delta)));
  };
  
  container.addEventListener('wheel', nativeWheelHandler, { passive: false });
  
  return () => {
    container.removeEventListener('wheel', nativeWheelHandler);
  };
}, []);
```

#### 2. Add Native Wheel Event Listener for Fullscreen Viewer

Add a second `useEffect` for the fullscreen container:

```typescript
// Native wheel handler for fullscreen viewer
useEffect(() => {
  const container = fullscreenContainerRef.current;
  if (!container || !fullscreenOpen) return;
  
  const nativeFullscreenWheelHandler = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setFullscreenZoom(z => Math.max(0.5, Math.min(5, z + delta)));
  };
  
  container.addEventListener('wheel', nativeFullscreenWheelHandler, { passive: false });
  
  return () => {
    container.removeEventListener('wheel', nativeFullscreenWheelHandler);
  };
}, [fullscreenOpen]);
```

#### 3. Remove React onWheel Props

Remove `onWheel={handleWheel}` from the inline viewer div (line 360).
Remove `onWheel={handleFullscreenWheel}` from the fullscreen viewer div (line 467).

Keep the `handleWheel` and `handleFullscreenWheel` functions as they can be deleted or retained for reference.

#### 4. Add CSS Safeguards

Add inline styles to both viewer containers:

```typescript
style={{ 
  height: "200px",
  touchAction: "none",           // Prevent touch scroll
  overscrollBehavior: "contain"  // Prevent scroll chaining
}}
```

For the fullscreen container:
```typescript
style={{ 
  height: "calc(95vh - 180px)",
  touchAction: "none",
  overscrollBehavior: "contain"
}}
```

---

## Summary of Changes

| Location | Change |
|----------|--------|
| Lines ~63-72 | Add `useEffect` for inline viewer native wheel handler |
| Lines ~73-85 | Add `useEffect` for fullscreen viewer native wheel handler |
| Line 349-361 | Add `touchAction: "none"` + `overscrollBehavior: "contain"` to inline container, remove `onWheel` |
| Line 456-468 | Add same CSS safeguards to fullscreen container, remove `onWheel` |
| Lines 181-185, 223-227 | Can delete `handleWheel` and `handleFullscreenWheel` callbacks (now unused) |

---

## Technical Notes

- **Why `{ passive: false }`?** Browsers default to passive wheel listeners for scroll performance. Only non-passive listeners can call `preventDefault()`.
- **Why `stopPropagation()`?** Prevents the event from bubbling up to parent containers or the window.
- **Why `touchAction: none`?** Prevents browser handling of touch gestures that might trigger scrolling.
- **Why `overscrollBehavior: contain`?** Prevents scroll chaining - when you reach the edge of a scrollable element, the scroll won't transfer to the parent.

---

## Acceptance Criteria

1. ✅ Mouse wheel inside viewer → zooms only, page does NOT scroll
2. ✅ Mouse wheel outside viewer → page scrolls normally
3. ✅ Works in fullscreen mode
4. ✅ Works with both mouse wheels and trackpads
5. ✅ No event listener leaks (cleanup on unmount)
6. ✅ No jitter or double-scroll behavior
