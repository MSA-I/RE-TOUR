# Manual Testing Checklist - Phase 4

## Date: 2026-02-11
## Server: http://localhost:8081

---

## ✅ Test 1: Pipeline Creation (Bug #1 & #3 Fixed)

**Goal**: Verify pipelines create without 400/404 errors

**Steps**:
1. [ ] Navigate to a project
2. [ ] Click "Create New Pipeline"
3. [ ] Select "Whole Apartment" mode
4. [ ] Upload floor plan
5. [ ] Submit

**Expected Result**:
- ✅ Pipeline creates successfully
- ✅ No 400 Bad Request error
- ✅ No 404 error for camera_intents_with_spaces

**Actual Result**:
_Fill in after testing_

**Status**: ⬜ PENDING

---

## 🚨 Test 2: Step 3 UI Verification (CRITICAL - Breaking Change)

**Goal**: Verify NEW template selection UI, confirm OLD camera placement UI is GONE

**Steps**:
1. [ ] Navigate to Step 3 (Camera Intent)
2. [ ] Observe the UI

**Expected Result**:
- ✅ NEW UI: Template selection checkboxes (Templates A-H)
- ✅ "Decision-Only" badge visible
- ✅ Validation messages for "at least 1 per space"
- ✅ NO camera placement floor plan
- ✅ NO draggable camera markers
- ✅ NO Camera A/B position controls

**Actual Result**:
_Describe what you see_

**Status**: ⬜ PENDING

---

## ✅ Test 3: Phase Transitions (Bug #2 Fixed)

**Goal**: Verify Step 2 → Step 3 transition works

**Steps**:
1. [ ] Complete Step 2 (Style)
2. [ ] Click "Approve & Continue"
3. [ ] Observe transition to Step 3

**Expected Result**:
- ✅ Transition completes successfully
- ✅ No 400 error "Phase camera_intent_pending expects step 4 but current_step is 3"
- ✅ Step 3 loads correctly

**Actual Result**:
_Fill in after testing_

**Status**: ⬜ PENDING

---

## 🔍 Test 4: Console Errors Check

**Goal**: Verify no JavaScript errors

**Steps**:
1. [ ] Open browser DevTools (F12)
2. [ ] Navigate through Steps 0-3
3. [ ] Check Console tab

**Expected Result**:
- ✅ No red errors in console
- ✅ No 400/404 network errors
- ✅ No React errors

**Actual Result**:
_Copy/paste any errors_

**Status**: ⬜ PENDING

---

## 📱 Test 5: Mobile Responsive (Optional)

**Goal**: Verify UI works on mobile

**Steps**:
1. [ ] Open DevTools
2. [ ] Toggle device toolbar (Ctrl+Shift+M)
3. [ ] Select iPhone or similar (375px width)
4. [ ] Test Step 3 UI

**Expected Result**:
- ✅ Checkboxes are tappable (≥ 44px touch targets)
- ✅ Text is readable
- ✅ No horizontal scrolling

**Actual Result**:
_Fill in after testing_

**Status**: ⬜ PENDING

---

## ♿ Test 6: Accessibility (Optional)

**Goal**: Verify keyboard navigation works

**Steps**:
1. [ ] Navigate to Step 3
2. [ ] Press Tab repeatedly
3. [ ] Try to select checkbox with Space bar

**Expected Result**:
- ✅ Tab cycles through all interactive elements
- ✅ Focus visible on checkboxes
- ✅ Space bar toggles checkboxes
- ✅ Screen reader announces selections

**Actual Result**:
_Fill in after testing_

**Status**: ⬜ PENDING

---

## 📊 Summary

| Test | Status | Pass/Fail |
|------|--------|-----------|
| 1. Pipeline Creation | ⬜ PENDING | - |
| 2. Step 3 UI (CRITICAL) | ⬜ PENDING | - |
| 3. Phase Transitions | ⬜ PENDING | - |
| 4. Console Errors | ⬜ PENDING | - |
| 5. Mobile Responsive | ⬜ PENDING | - |
| 6. Accessibility | ⬜ PENDING | - |

---

## 🚀 Next Steps After Testing

### If All Tests Pass:
- Proceed to **Phase 5: Production Deployment**
- Deploy edge functions
- Build and deploy frontend
- Push commits to remote
- Monitor production for 24-48 hours

### If Any Tests Fail:
- Document failure details
- Debug specific issues
- Re-test after fixes
- Do NOT proceed to deployment until all CRITICAL tests pass

---

## Critical Files Modified (For Reference)

**Frontend**:
- `src/hooks/useFloorplanPipelines.ts` - Sets current_step: 0 for whole_apartment
- `src/components/WholeApartmentPipelineCard.tsx` - Fixed query ordering

**Backend**:
- `supabase/functions/continue-pipeline-step/index.ts` - Explicitly sets phase + step
- `supabase/functions/run-batch-space-renders/index.ts` - camera_intent_confirmed_at
- `supabase/functions/reset-floorplan-pipeline/index.ts` - camera_intent_confirmed_at
- `supabase/functions/restart-pipeline-step/index.ts` - camera_intent_confirmed_at
- `supabase/functions/run-single-space-renders/index.ts` - camera_intent_confirmed_at

**Database**:
- Applied HOTFIX_COMPLETE_SETUP_V2.sql (enum, trigger, view, indexes)

**Deleted**:
- `supabase/functions/confirm-camera-plan/` - OLD Step 3 function

---

## Notes

- This is the first end-to-end test of the NEW camera intents architecture
- Step 3 is now "Decision-Only" - no camera placement UI
- Users select template checkboxes instead of dragging markers
- This is a BREAKING CHANGE from OLD architecture
