# QA Tags Implementation - Complete

## Problem A: Duplicate QA in Step 2 ✅ FIXED

**Issue:** Step 2 showed TWO QA areas that looked interactive
- Top panel: StageReviewPanel with Approve/Reject (correct)
- Lower section: Attempt history with "Needs Review" badges (looked interactive)

**Solution:**
Updated `Step2OutputsPanel.tsx` to be explicitly read-only:
- Removed yellow "Needs Review" badge (replaced with neutral "Pending")
- Added prominent header: "📜 Attempt History (read-only)"
- De-emphasized cards with muted styling (border-border/30, bg-muted/10)
- Clear messaging: "Use panel above to approve/reject"
- Historical QA decisions now labeled "Historical QA Decision"

**Result:** Users see ONE clear QA control area (top), history stays visible below as read-only reference.

---

## Problem B: Different Tags for Approve vs Reject ✅ FIXED

**Issue:** Generic tags applied to both approve and reject decisions

**Solution:**
Created separate tag sets in `QAFeedbackDialog.tsx`:

### APPROVE TAGS (What is GOOD and should be preserved)
```typescript
export const APPROVE_TAGS = [
  "Accurate Layout",
  "Correct Scale",
  "Correct Openings",
  "Good Camera Intent Match",
  "Style Match",
  "Clear / Readable",
  "Good Lighting",
  "Other",
]
```

### REJECT TAGS (What is WRONG and should be avoided/fixed)
```typescript
export const REJECT_TAGS = [
  "Geometry/Layout Wrong",
  "Scale/Proportions Wrong",
  "Doors/Openings Wrong",
  "Windows Wrong",
  "Camera Not Eye-Level / Wrong FOV",
  "Style Drift",
  "Artifacts / Broken Image",
  "Missing Details / Hallucination",
  "Other",
]
```

---

## Payload Structure

When user clicks **Approve** or **Reject**, the following payload is sent:

```typescript
{
  decision: "approved" | "rejected",    // Action taken
  tags: string[],                       // Selected tags (required, at least 1)
  tags_type: "approve" | "reject",      // Which tag set was used
  score: number,                        // 0-100 (required)
  reasonShort: string,                  // Optional note (max 500 chars)
  qaWasWrong: boolean,                  // If overriding AI-QA
  category: string,                     // Backward compatibility (auto-mapped from tags[0])
}
```

### Example Approve Payload:
```json
{
  "decision": "approved",
  "tags": ["Accurate Layout", "Correct Scale", "Good Lighting"],
  "tags_type": "approve",
  "score": 85,
  "reasonShort": "Bedroom proportions are perfect, lighting natural",
  "qaWasWrong": false,
  "category": "structural_change"
}
```

### Example Reject Payload:
```json
{
  "decision": "rejected",
  "tags": ["Geometry/Layout Wrong", "Doors/Openings Wrong"],
  "tags_type": "reject",
  "score": 35,
  "reasonShort": "Missing wall between kitchen and living room",
  "qaWasWrong": false,
  "category": "structural_change"
}
```

---

## Components Changed

### 1. **QAFeedbackDialog.tsx** (src/components/whole-apartment/)
- Added `APPROVE_TAGS` and `REJECT_TAGS` constants
- Shows appropriate tag set based on `mode` prop
- Tags colored green for approve, red for reject
- Label changes: "Approve Tags" vs "Reject Tags"
- Help text explains: "what is good" vs "what is wrong"
- Added `tags_type` to `QAFeedbackData` interface
- Updated `handleSubmit` to include `tags_type` in payload

### 2. **Step2OutputsPanel.tsx** (src/components/whole-apartment/)
- Header changed: Added "📜 Attempt History" badge with read-only notice
- Removed yellow "Needs Review" badge → replaced with neutral "Pending"
- Cards de-emphasized: muted borders, muted text colors
- Header background: `bg-muted/10` to differentiate from active panels
- QA decision display: labeled "Historical QA Decision"

### 3. **StageReviewPanel.tsx** (src/components/whole-apartment/)
- Updated `handleApproveWithFeedback` to pass `tags` and `tags_type`
- Updated `handleRejectWithFeedback` to pass `tags` and `tags_type`
- Calls `storeQAFeedback.mutate()` with new fields

### 4. **useQAFeedback.ts** (src/hooks/)
- Updated `StoreQAFeedbackParams` interface:
  - Added `tags?: string[]`
  - Added `tags_type?: "approve" | "reject"`
- These are passed through to backend edge function

---

## Backward Compatibility

**Maintained:**
- `category` field still sent (auto-mapped from first tag)
- Existing QA learning system continues to work
- No breaking changes to backend contracts

**Enhanced:**
- Backend can now differentiate approve vs reject signals
- Structured tags provide better learning data
- Future: Can build separate approve/reject models

---

## UI Flow

### When user clicks "Approve":
1. Modal opens with "Approve Step X Output" title
2. Shows APPROVE_TAGS in green theme
3. User selects 1+ tags (required)
4. User enters score 0-100 (required)
5. User adds optional note
6. Clicks "Approve" → payload sent with `tags_type: "approve"`

### When user clicks "Reject":
1. Modal opens with "Reject Step X Output" title
2. Shows REJECT_TAGS in red theme
3. User selects 1+ tags (required)
4. User enters score 0-100 (required)
5. User adds optional note
6. Clicks "Reject" → payload sent with `tags_type: "reject"`

---

## Testing Checklist

- [ ] Step 2: Only ONE approve/reject control visible (top panel)
- [ ] Step 2: History section clearly read-only (no yellow badges)
- [ ] Approve modal: Shows green APPROVE_TAGS
- [ ] Reject modal: Shows red REJECT_TAGS
- [ ] Can't submit without selecting at least 1 tag
- [ ] Can't submit without entering score 0-100
- [ ] Note field is optional
- [ ] Payload includes `tags` array
- [ ] Payload includes `tags_type` matching decision
- [ ] Backend receives and stores new fields

---

## Next Steps (Future Enhancements)

1. **Backend Learning:** Update edge functions to leverage `tags` and `tags_type` for smarter QA
2. **Analytics:** Track which tags are most common per step
3. **Tag Suggestions:** Auto-suggest tags based on AI-QA report
4. **Tag Evolution:** Allow admins to add/modify tags without code changes
5. **Multi-language:** Translate tag labels for international users

---

## Commit

```
fix: separate approve/reject tags and clarify Step 2 history panel

Problem A - Duplicate QA in Step 2:
- Updated Step2OutputsPanel to be explicitly read-only
- Removed "Needs Review" badge (replaced with "Pending")
- Added clear header: "📜 Attempt History (read-only)"

Problem B - Different tags for Approve vs Reject:
- Created APPROVE_TAGS (positive signals)
- Created REJECT_TAGS (negative signals)
- Added tags_type field to payload
- Backward compatible with existing category field

Components: QAFeedbackDialog, Step2OutputsPanel,
            StageReviewPanel, useQAFeedback
```

Commit hash: `837f262`
