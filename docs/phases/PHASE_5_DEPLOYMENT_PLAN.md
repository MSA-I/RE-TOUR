# Phase 5: Production Deployment Plan

## Prerequisites (Phase 4 Must Pass First)

- [ ] Test 1: Pipeline Creation - PASSED
- [ ] Test 2: Step 3 UI Verification (CRITICAL) - PASSED
- [ ] Test 3: Phase Transitions - PASSED
- [ ] Test 4: Console Errors - PASSED

**⚠️ DO NOT DEPLOY until all CRITICAL tests pass!**

---

## Step 1: Deploy Edge Functions

### Edge Functions Modified (Need Deployment)

The following edge functions were updated to use `camera_intent_confirmed_at` instead of `camera_plan_confirmed_at`:

1. `continue-pipeline-step` - Explicitly sets phase + step together
2. `save-camera-intents` - Saves camera intent selections
3. `run-space-render` - Renders individual space
4. `run-batch-space-renders` - Batch rendering with camera intent check
5. `reset-floorplan-pipeline` - Clears camera intent confirmation
6. `restart-pipeline-step` - Clears camera intent when restarting Step 4+
7. `run-single-space-renders` - Single space rendering with camera intent check

### Deployment Commands

```bash
# Navigate to project root
cd A:\RE-TOUR

# Deploy in dependency order (most critical first)
supabase functions deploy continue-pipeline-step
supabase functions deploy save-camera-intents
supabase functions deploy run-space-render
supabase functions deploy run-batch-space-renders
supabase functions deploy run-single-space-renders
supabase functions deploy reset-floorplan-pipeline
supabase functions deploy restart-pipeline-step

# Verify all deployed successfully
supabase functions list
```

**Expected Output**:
```
┌────────────────────────────┬─────────┬───────────────────────┐
│ NAME                       │ VERSION │ UPDATED               │
├────────────────────────────┼─────────┼───────────────────────┤
│ continue-pipeline-step     │ XXX     │ 2026-02-11 XX:XX:XX   │
│ save-camera-intents        │ XXX     │ 2026-02-11 XX:XX:XX   │
│ run-space-render           │ XXX     │ 2026-02-11 XX:XX:XX   │
│ run-batch-space-renders    │ XXX     │ 2026-02-11 XX:XX:XX   │
│ run-single-space-renders   │ XXX     │ 2026-02-11 XX:XX:XX   │
│ reset-floorplan-pipeline   │ XXX     │ 2026-02-11 XX:XX:XX   │
│ restart-pipeline-step      │ XXX     │ 2026-02-11 XX:XX:XX   │
└────────────────────────────┴─────────┴───────────────────────┘
```

### Rollback Plan for Edge Functions

If issues occur:
```bash
# Revert to previous version
supabase functions deploy <function-name> --version <previous-version-id>
```

---

## Step 2: Build Frontend

```bash
# Build production bundle
npm run build

# Expected output: dist/ folder created with optimized assets

# Preview production build locally (optional)
npm run preview
# Open http://localhost:4173 and verify
```

**Verification**:
- [ ] Build completes without errors
- [ ] `dist/` folder created
- [ ] Preview works correctly

---

## Step 3: Deploy Frontend

### Option A: Vercel
```bash
# If using Vercel CLI
vercel --prod

# Or push to main branch (auto-deploys)
git push origin main
```

### Option B: Netlify
```bash
# If using Netlify CLI
netlify deploy --prod

# Or push to main branch (auto-deploys)
git push origin main
```

### Option C: Other Hosting
Follow your standard deployment process for:
- **Cloudflare Pages**: Push to main branch
- **AWS Amplify**: Push to main branch
- **Custom Server**: Copy `dist/` folder to server

---

## Step 4: Push Git Commits to Remote

```bash
# Verify all commits are local
git log --oneline -5

# Expected commits:
# 3e003be feat: add new Step 3 & 4 UI components and edge functions
# fcfd2f9 docs: add deployment and fix documentation
# a3d8393 feat: migrate to camera intents architecture (Step 3 redesign)

# Push to remote
git push origin main

# Verify push succeeded
git status
# Should show: "Your branch is up to date with 'origin/main'"
```

---

## Step 5: Verify Production Deployment

### 5.1 Check Production URL

Open your production URL (e.g., https://your-app.vercel.app)

**Checklist**:
- [ ] Site loads correctly
- [ ] No 404 errors
- [ ] No 400 Bad Request errors
- [ ] Step 3 shows NEW template UI
- [ ] Can create pipeline
- [ ] Can complete full flow (Step 0 → Step 3)

### 5.2 Check Supabase Logs

```bash
# Or view in Supabase Dashboard → Edge Functions → Logs
```

**Look for**:
- [ ] No errors in `continue-pipeline-step`
- [ ] No errors in `save-camera-intents`
- [ ] No errors in render functions
- [ ] No constraint violations

### 5.3 Check Database State

In Supabase SQL Editor:
```sql
-- Check for phase/step mismatches
SELECT id, whole_apartment_phase, current_step, status
FROM floorplan_pipelines
WHERE whole_apartment_phase IS NOT NULL
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;

-- Should show consistent phase/step pairs (no mismatches)
```

### 5.4 Monitor Error Rates

Check for 24-48 hours:
- [ ] Error rate < 1%
- [ ] No constraint violations
- [ ] No missing view errors
- [ ] No phase/step mismatch errors

---

## Step 6: Post-Deployment Verification

### Test Scenarios in Production

1. **Create New Pipeline**
   - [ ] Works without errors
   - [ ] Phase: "upload", Step: 0

2. **Complete Step 0 → Step 1**
   - [ ] Transition works
   - [ ] Phase: "top_down_3d_pending", Step: 1

3. **Complete Step 1 → Step 2**
   - [ ] Transition works
   - [ ] Phase: "style_pending", Step: 2

4. **Complete Step 2 → Step 3**
   - [ ] Transition works (was failing before)
   - [ ] Phase: "detect_spaces_pending", Step: 3

5. **Complete Step 3 → Step 4**
   - [ ] Transition works
   - [ ] Phase: "camera_intent_pending", Step: 4
   - [ ] Shows NEW template selection UI

6. **Save Camera Intents**
   - [ ] Checkboxes work
   - [ ] Validation works (at least 1 per space)
   - [ ] "Confirm" button advances to next step

---

## Rollback Procedures

### If Frontend Has Issues

**Option 1: Revert Frontend Deployment**
```bash
# Vercel
vercel rollback

# Netlify
netlify rollback
```

**Option 2: Revert Git Commits**
```bash
# Create revert commit
git revert 3e003be..a3d8393

# Push revert
git push origin main
```

### If Edge Functions Have Issues

```bash
# Revert specific function
supabase functions deploy <function-name> --version <previous-version>

# Or redeploy from previous git commit
git checkout cefbeda -- supabase/functions/<function-name>
supabase functions deploy <function-name>
```

### If Database Has Issues

Run emergency fix:
```sql
-- Fix any pipelines stuck in bad state
UPDATE floorplan_pipelines
SET current_step = CASE whole_apartment_phase::TEXT
  WHEN 'upload' THEN 0
  WHEN 'space_analysis_pending' THEN 0
  WHEN 'top_down_3d_pending' THEN 1
  WHEN 'top_down_3d_running' THEN 1
  WHEN 'style_pending' THEN 2
  WHEN 'style_running' THEN 2
  WHEN 'detect_spaces_pending' THEN 3
  WHEN 'detecting_spaces' THEN 3
  WHEN 'camera_intent_pending' THEN 4
  WHEN 'camera_intent_confirmed' THEN 4
  WHEN 'prompt_templates_pending' THEN 5
  WHEN 'prompt_templates_confirmed' THEN 5
  WHEN 'outputs_pending' THEN 6
  WHEN 'outputs_in_progress' THEN 6
  WHEN 'outputs_review' THEN 6
  ELSE current_step
END
WHERE whole_apartment_phase IS NOT NULL;
```

---

## Success Criteria

- [ ] All 7 edge functions deployed successfully
- [ ] Frontend deployed and accessible
- [ ] Git commits pushed to remote
- [ ] Production verification tests pass
- [ ] No errors in Supabase logs (< 1% error rate)
- [ ] Can create pipeline in production
- [ ] Can complete full pipeline flow (Step 0 → 4)
- [ ] Step 3 shows NEW template selection UI (not OLD camera placement)
- [ ] No 400/404 errors in production
- [ ] Database has no phase/step mismatches

---

## Timeline

- **Edge Function Deployment**: 5-10 minutes
- **Frontend Build**: 2-3 minutes
- **Frontend Deployment**: 5-10 minutes (auto-deploy)
- **Git Push**: 1 minute
- **Production Verification**: 10-15 minutes
- **Initial Monitoring**: 30 minutes
- **Total**: ~1 hour

**Extended Monitoring**: 24-48 hours

---

## Notes

- Deploy during low-traffic hours if possible
- Have rollback plan ready
- Monitor error logs closely for first hour
- Test all critical user flows in production
- Document any deviations from this plan
- Keep this file updated with actual results

---

## Deployment Checklist

### Pre-Deployment
- [ ] Phase 4 manual testing complete and PASSED
- [ ] All git commits verified
- [ ] Rollback plan documented
- [ ] Team notified (if applicable)

### During Deployment
- [ ] Edge functions deployed
- [ ] Frontend built successfully
- [ ] Frontend deployed
- [ ] Git commits pushed
- [ ] Production URL accessible

### Post-Deployment
- [ ] Production verification tests passed
- [ ] Error logs checked
- [ ] Database state verified
- [ ] Monitoring alerts configured
- [ ] Team notified of success

### 24-48 Hour Follow-up
- [ ] No critical errors
- [ ] Error rate < 1%
- [ ] User feedback collected
- [ ] Performance metrics normal
