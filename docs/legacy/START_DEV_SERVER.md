# Start Development Server - Quick Guide

**Date**: 2026-02-11
**Status**: All UI/Backend changes are committed and ready

---

## 🚀 Start the Dev Server

```bash
cd A:/RE-TOUR
npm run dev
```

The dev server will start at: **http://localhost:5173** (or similar port)

---

## ✅ What's New

After starting the server, you'll see these changes:

### Step 2 → Step 3 Transition
- ✅ Button now says **"Continue to Camera Intent"** (not "Detect Spaces")
- ✅ Transitions to `camera_intent_pending` phase

### Step 3 UI
- ✅ **No "Detect Spaces" button** (legacy element hidden)
- ✅ Camera Intent Selector with Templates A-H visible
- ✅ Decision-only interface

### Step 4 UI (NEW)
- ✅ **Step4SelectionPanel** appears after camera intents confirmed
- ✅ "Configure Renders" button opens selection modal
- ✅ "Generate Prompts" button (idempotent - no duplicates)
- ✅ "Generate Images" button (after prompts exist)

---

## 🧪 Test the Changes

### Test 1: Camera Intent Flow
1. Complete Steps 0-2 in a pipeline
2. Click "Continue to Camera Intent" after Step 2 approval
3. **Expected**: Step 3 shows Camera Intent Selector (Templates A-H)
4. **Expected**: No "Detect Spaces" button visible

### Test 2: Step 4 Selection Panel
1. Complete Step 3 (define camera intents)
2. Click "Confirm Intents"
3. **Expected**: Step 4 panel appears with "Configure Renders" button
4. Click "Configure Renders"
5. **Expected**: Modal opens with camera intent checkboxes
6. Select intents, click "Generate Prompts"
7. **Expected**: Toast shows "Prompts Generated"

### Test 3: Idempotency
1. After generating prompts (Test 2)
2. Click "Generate Prompts" again (same intents)
3. **Expected**: No error, success message again
4. Check database (see query below)
5. **Expected**: No duplicate records

### Test 4: Text Preservation
1. Complete Step 1 with white labels
2. Approve Step 1
3. Run Step 2 (Style Application)
4. **Expected**: White labels preserved in Step 2 output

---

## 🔍 Database Verification Queries

Open Supabase SQL Editor and run:

### Check for Duplicate Renders
```sql
SELECT camera_label, COUNT(*) as count
FROM floorplan_space_renders
WHERE pipeline_id = '<your-pipeline-id>'
  AND status = 'planned'
GROUP BY camera_label
HAVING COUNT(*) > 1;
```
**Expected**: 0 rows (no duplicates)

### Check Phase Transition
```sql
SELECT id, whole_apartment_phase, current_step
FROM floorplan_pipelines
WHERE id = '<your-pipeline-id>';
```
**After Step 2 approval, expected**: `camera_intent_pending` (not `detect_spaces_pending`)

---

## 📊 Dev Server Features

Vite dev server includes:
- ✅ **Hot Module Replacement (HMR)**: Changes reload automatically
- ✅ **Fast Refresh**: React components update without full reload
- ✅ **Source Maps**: Debug with original TypeScript source
- ✅ **Console Logs**: Check browser console for debug info

---

## 🐛 If You See Issues

### Issue 1: Old UI Still Visible
**Solution**: Hard refresh the browser
- Chrome/Edge: `Ctrl + Shift + R` or `Ctrl + F5`
- Firefox: `Ctrl + Shift + R`
- Safari: `Cmd + Shift + R`

### Issue 2: TypeScript Errors
**Solution**: Restart the dev server
```bash
# Stop with Ctrl+C, then restart
npm run dev
```

### Issue 3: Port Already in Use
**Solution**: Kill existing process or use different port
```bash
# Find process on port 5173
netstat -ano | findstr :5173

# Kill process (replace PID with actual number)
taskkill /PID <PID> /F

# Or start on different port
npm run dev -- --port 3000
```

### Issue 4: Changes Not Appearing
**Solution**: Clear browser cache and restart dev server
```bash
# Stop server (Ctrl+C)
# Clear browser cache (Ctrl+Shift+Delete)
npm run dev
```

---

## 📝 What's Been Changed

### Frontend Files
- `src/components/WholeApartmentPipelineCard.tsx` - UI wiring fixes
- `src/components/whole-apartment/Step4SelectionPanel.tsx` - NEW component

### Backend Files (Already Deployed)
- `supabase/functions/generate-camera-prompts/index.ts` - NEW function
- `supabase/functions/run-pipeline-step/index.ts` - Text preservation

### Git Status
- ✅ 7 commits pushed to main
- ✅ All changes committed
- ✅ Latest: Documentation updates

---

## 🎯 Success Checklist

After starting the dev server, verify:

- [ ] Server starts successfully at http://localhost:5173
- [ ] No "Detect Spaces" button visible after Step 2
- [ ] "Continue to Camera Intent" button appears
- [ ] Camera Intent Selector shows Templates A-H
- [ ] Step 4 shows "Configure Renders" button
- [ ] "Generate Prompts" works without errors
- [ ] Second click doesn't create duplicates
- [ ] Phase transitions correctly (check database)

---

## 💡 Pro Tips

**Keep Dev Server Running**: Vite's HMR means you don't need to restart for most code changes.

**Check Console**: Open browser DevTools (F12) to see:
- API calls to Supabase functions
- React component renders
- Debug logs from the application

**Monitor Supabase Logs**: Check edge function logs at:
https://supabase.com/dashboard/project/[your-project-id]/functions

**Database Changes**: Use Supabase Dashboard to watch real-time changes to tables during testing.

---

**Quick Start Command**:
```bash
npm run dev
```

**Then open**: http://localhost:5173

---

**END OF GUIDE**
