# Progressive QA Learning System - Implementation Summary

## Overview
Implemented a sophisticated progressive learning system that prevents the QA from becoming overly rigid while still learning from repeated mistakes. Based on `qa_learning_system_design.md.resolved`.

## Implementation Date
February 10, 2026

---

## Core Philosophy

**The Problem**: Traditional learning systems either learn too slowly or become too restrictive.

**The Solution**: Progressive strength with natural decay - rules start weak and only strengthen with repeated violations, while automatically weakening when they're no longer relevant.

---

## 1. Three-Tier Learning Levels

### Level 1: Pipeline Instance (Temporary) ⏱️
**Scope**: Current work-in-progress only
**Trigger**: Same error happens 2x in one pipeline
**Action**: Highlights specific error: "You just fixed this, don't break it again"
**Persistence**: Clears when pipeline completes

**Implementation**:
- Table: `qa_pipeline_instance_rules`
- Tracks: `pipeline_id`, `trigger_count`, `rule_text`
- Auto-cleanup when pipeline finishes

### Level 2: User Preference (Personal) 👤
**Scope**: One specific user across all their work
**Trigger**: User makes same mistake across 3 different pipelines
**Action**: Adds personal checklist item
**Persistence**: Stays until user changes behavior or rule decays

**Implementation**:
- Uses existing `qa_policy_rules` with `scope_level = 'step'/'project'`
- Promotion logic in `checkForUserLevelPromotion()`
- Subject to health decay system

### Level 3: Global Standard (System-Wide) 🌐
**Scope**: Applies to everyone
**Trigger**: 10+ users make same mistake OR admin marks as critical
**Action**: Updates official validation rules
**Persistence**: Permanent until manually changed

**Implementation**:
- Uses `qa_policy_rules` with `scope_level = 'global'`
- Manually promoted by admins (strength_stage = 'law')
- Immune to health decay when locked

---

## 2. Progressive Strength System

Rules grow in strength through 4 stages:

### Stage 1: Nudge 💡 (1-2 Violations)
**Behavior**: Passive hint
**UI**: Info card with blue border
**Blocking**: None
**Message**: "Tip: Avoid X"

### Stage 2: Check ✓ (3-5 Violations)
**Behavior**: Active question
**UI**: Yellow card with checkbox
**Blocking**: Must click "Yes" to proceed
**Message**: "Did you check X? It caused a rejection last time."

### Stage 3: Guard 🛡️ (6+ Violations)
**Behavior**: Warning state
**UI**: Orange card requiring override reason
**Blocking**: Soft block with override
**Message**: "Warning: High risk of rejection due to X"

### Stage 4: Law ⚖️ (Admin-promoted)
**Behavior**: Hard rule
**UI**: Red card, no override option
**Blocking**: Hard block, cannot proceed
**Message**: "Error: X is not allowed"

**Automatic Progression**:
```typescript
violation_count >= 6 → Guard
violation_count >= 3 → Check
violation_count >= 1 → Nudge
manually_promoted → Law
```

**Exception**: Low-confidence rules (< 70%) stay at Nudge forever, even with many violations.

---

## 3. Health Bar & Decay System

Every rule has a health bar (0-100). When health hits 0, the rule dies or demotes.

### Time Decay ⏰
**Rate**: -2 health per day
**Purpose**: Rules naturally weaken if not triggered
**Example**: Unused rule takes 50 days to die

### Good Behavior Decay ✅
**Rate**: -5 health per completed task without triggering
**Purpose**: "They learned it, we don't need to nag anymore"
**Example**: If user successfully completes 5 tasks without violating a rule, it loses 25 health

### False Positive Decay ❌
**Rate**: -30 health when rule triggers but QA approves anyway
**Purpose**: Bad rules die fast
**Example**: 3 false positives = rule death (90 health lost)

### Health Effects on Strength:
```
Health <= 30 + Guard stage → Demote to Check
Health <= 15 + Check stage → Demote to Nudge
Health = 0 → Rule disabled
```

### Locked Rules 🔒
Users can "lock" important rules to prevent decay. Locked rules maintain full health.

---

## 4. User Control Dashboard

### Features:
- **View All Active Rules**: Organized by strength stage
- **Mute Rules**: Temporarily disable without deleting
- **Lock Rules**: Prevent decay on important rules
- **Delete Rules**: Permanently remove
- **Fresh Start**: Reset entire learning profile (wipes Level 1 & 2, keeps Level 3)

### UI Components:
- `QALearningDashboard.tsx` - Main dashboard
- `QAProgressiveWarning.tsx` - In-flow warnings
- Shows health bars, confidence scores, violation counts

---

## 5. Confidence Scoring

**Purpose**: Prevents inconsistent rules from becoming blocking.

**Calculation**:
```typescript
confidence = rejected_due_to_trigger / triggered_count
```

**Example**:
- Rule triggers 10 times
- 8 times → QA rejects (correct prediction)
- 2 times → QA approves (false positive)
- Confidence = 8/10 = 80% ✓

**Thresholds**:
- **>= 70%**: Rule can become blocking (Check/Guard/Law)
- **< 70%**: Rule stays at Nudge forever
- **Minimum 5 samples**: Need at least 5 triggers to calculate confidence

**Effect**:
Low-confidence rules show hints but never block work, preventing frustrating false positives.

---

## 6. Context Specificity

Rules are never just "Don't do X". They're "Don't do X *when* Y is true".

**Implementation**:
```typescript
context_conditions: {
  room_type: "bedroom",
  camera_type: "wide_angle",
  // ... other conditions
}
```

**Example**:
❌ Bad rule: "Don't use low contrast"
✅ Good rule: "Don't use low contrast *on text layers*"

Rules only trigger when ALL context conditions match.

---

## Database Schema

### New Tables

#### `qa_pipeline_instance_rules`
```sql
- pipeline_id UUID (FK to floorplan_pipelines)
- trigger_count INTEGER (how many times violated)
- rule_text TEXT (what was violated)
- first_triggered_at, last_triggered_at
```

#### `qa_rule_overrides`
```sql
- rule_id UUID (FK to qa_policy_rules)
- override_reason TEXT (user explanation)
- rule_strength_stage TEXT (what they overrode)
- was_approved_by_qa BOOLEAN (did QA approve afterward?)
```

#### `qa_user_learning_profile`
```sql
- user_id UUID UNIQUE
- learning_enabled BOOLEAN
- last_profile_reset_at TIMESTAMPTZ
- custom_thresholds JSONB
```

### Extended Columns on `qa_policy_rules`

```sql
-- Strength system
strength_stage TEXT CHECK IN ('nudge', 'check', 'guard', 'law')
health INTEGER CHECK (0-100)

-- Confidence scoring
confidence_score NUMERIC(5,4) CHECK (0-1)
triggered_count INTEGER
approved_despite_trigger INTEGER
rejected_due_to_trigger INTEGER

-- Context specificity
context_conditions JSONB

-- User controls
user_muted BOOLEAN
user_locked BOOLEAN

-- Decay tracking
last_triggered_at TIMESTAMPTZ
last_health_decay_at TIMESTAMPTZ
```

---

## Key Functions

### Progressive Learning Library (`progressive-learning.ts`)

#### Level Management
- `trackPipelineInstanceRule()` - Track temporary rule
- `getPipelineInstanceRules()` - Get active pipeline rules
- `checkForUserLevelPromotion()` - Check if rule should promote to user level

#### Strength Management
- `calculateStrengthStage()` - Determine appropriate stage
- `updateRuleStrength()` - Promote rule to next stage

#### Health & Decay
- `applyTimeDecay()` - Daily cron job for time decay
- `applyGoodBehaviorDecay()` - Decay when task completes without violation
- `applyFalsePositiveDecay()` - Heavy damage for false positives

#### Confidence
- `calculateConfidenceScore()` - Compute consistency score
- `updateConfidenceScore()` - Update after QA result

#### User Controls
- `recordRuleOverride()` - Track when user overrides
- `resetUserLearningProfile()` - Fresh start button

---

## UI Components

### `QALearningDashboard.tsx`
Full-featured dashboard for managing learned rules:
- View rules by strength stage (Law/Guard/Check/Nudge)
- Health bars and confidence scores
- Mute/unmute, lock/unlock, delete actions
- Fresh start dialog
- Shows muted rules separately

### `QAProgressiveWarning.tsx`
In-flow warning system shown during pipeline execution:
- **Law rules**: Red cards, cannot proceed
- **Guard rules**: Orange cards, requires override reason (min 10 chars)
- **Check rules**: Yellow cards, must check box to confirm
- **Nudge rules**: Blue cards, informational only

---

## Integration Points

### During Pipeline Execution

1. **Check for triggered rules**:
   ```typescript
   // Check pipeline-instance rules
   const pipelineRules = await getPipelineInstanceRules(pipelineId, stepId);

   // Check user-level rules
   const userRules = await supabase
     .from('qa_policy_rules')
     .eq('owner_id', userId)
     .eq('rule_status', 'active')
     .eq('user_muted', false);
   ```

2. **Show progressive warnings**:
   ```tsx
   <QAProgressiveWarning
     triggeredRules={rules}
     onProceed={handleProceed}
     onCancel={handleCancel}
   />
   ```

3. **Record overrides** (if user proceeds anyway):
   ```typescript
   await recordRuleOverride(ruleId, pipelineId, ownerId, stepId, stage, reason);
   ```

4. **After QA result**:
   ```typescript
   // Update confidence
   await updateConfidenceScore(ruleId, qaResult.pass);

   // Apply false positive decay if needed
   if (ruleTriggered && qaResult.pass) {
     await applyFalsePositiveDecay(ruleId, rule);
   }
   ```

5. **On pipeline completion**:
   ```typescript
   // Apply good behavior decay to non-triggered rules
   await applyGoodBehaviorDecay(ownerId, stepId, pipelineId);
   ```

### Daily Cron Job

```typescript
// Apply time decay to all active rules
await applyTimeDecay(supabase);
```

Should run once per day via scheduled function.

---

## Example Scenarios

### Scenario 1: Learning from a Mistake

**Pipeline 1, Step 4**:
1. User forgets to check wall alignment
2. QA rejects → Create pipeline-instance rule (Level 1, Nudge stage)
3. User retries → Warning shown: "Tip: Check wall alignment"
4. User fixes → QA approves

**Pipeline 1 completes**:
- Rule cleared (temporary)

**Pipeline 2, Step 4**:
1. User forgets wall alignment again
2. QA rejects → Create new pipeline-instance rule
3. User fixes → QA approves

**Pipeline 3, Step 4**:
1. User forgets wall alignment AGAIN
2. System checks: "This happened in 3 pipelines now"
3. Promote to User Level (Level 2, Nudge stage, health=100)
4. Warning shown: "Tip: Check wall alignment (you've missed this before)"

**Next 2 violations** (same rule):
- violation_count = 3 → Promote to "check" stage
- User now must CHECK BOX to proceed

**3 more violations**:
- violation_count = 6 → Promote to "guard" stage
- User must TYPE REASON to override

### Scenario 2: Rule Decay

**Day 1**: Rule created, health=100, stage=nudge

**Days 2-25**: User successfully completes tasks without violating
- Time decay: -2/day = -50 health
- Good behavior decay: -5 per task × 10 tasks = -50 health
- Health = 0 → Rule dies

**Result**: User learned! No more nagging needed.

### Scenario 3: False Positive

**Rule**: "Don't use red walls in bedrooms" (stage=check, health=80, confidence=90%)

**Violation**:
1. User uses red accent wall
2. Rule triggers → "Did you check bedroom wall color?"
3. User confirms → Proceeds
4. QA approves (it's actually fine)
5. False positive penalty: health -30, confidence drops to 70%

**After 2 more false positives**:
- Health = 20, confidence = 40%
- Rule demotes to "nudge" (low confidence)
- Rule will never block again (confidence < 70%)

**After 1 more false positive**:
- Health = 0 → Rule dies

**Result**: Bad rules get killed quickly.

---

## Configuration

### Strength Thresholds
```typescript
STRENGTH_THRESHOLDS = {
  nudge: 1,    // 1-2 violations
  check: 3,    // 3-5 violations
  guard: 6,    // 6+ violations
  law: ∞       // Manual promotion only
}
```

### Health Decay Rates
```typescript
HEALTH_DECAY = {
  TIME_DECAY_PER_DAY: 2,
  GOOD_BEHAVIOR_DECAY: 5,
  FALSE_POSITIVE_DECAY: 30
}
```

### Confidence Thresholds
```typescript
CONFIDENCE_THRESHOLD = {
  MIN_FOR_BLOCKING: 0.7,  // 70%
  MIN_SAMPLE_SIZE: 5
}
```

---

## Edge Functions

### New Functions (3)
1. `reset-learning-profile` - Fresh start button
2. `get-constraint-stack-depth` - (from previous implementation)
3. `get-rule-promotion-log` - (from previous implementation)

---

## Migration Files

1. `20260210160200_add_progressive_learning_system.sql`
   - Pipeline instance rules table
   - Extended qa_policy_rules columns
   - Rule overrides table
   - User learning profile table

---

## Next Steps

1. **Apply Migration**:
   ```bash
   supabase db push
   ```

2. **Deploy Functions**:
   ```bash
   supabase functions deploy reset-learning-profile
   ```

3. **Set Up Cron Job**:
   - Schedule daily execution of `applyTimeDecay()`
   - Recommended time: 2 AM UTC

4. **Integrate Warnings**:
   - Add `QAProgressiveWarning` to pipeline execution flow
   - Check triggered rules before allowing QA submission
   - Record overrides when user proceeds anyway

5. **Add Dashboard Link**:
   - Add "My Learning Rules" link to user profile menu
   - Route to `QALearningDashboard` component

---

## Testing Checklist

- [ ] Apply migration successfully
- [ ] Create pipeline-instance rule (violate twice in same pipeline)
- [ ] Verify rule clears on pipeline completion
- [ ] Trigger same error in 3 pipelines → promotes to user level
- [ ] Verify nudge warning shows (stage 1)
- [ ] Trigger 3 more times → promotes to check stage
- [ ] Verify checkbox confirmation required (stage 2)
- [ ] Trigger 3 more times → promotes to guard stage
- [ ] Verify override reason required (stage 3)
- [ ] Complete task without triggering → verify good behavior decay
- [ ] Override rule + get QA approval → verify false positive decay
- [ ] Wait 24 hours → verify time decay applied
- [ ] Lock a rule → verify it doesn't decay
- [ ] Mute a rule → verify it doesn't trigger
- [ ] Delete a rule → verify it's disabled
- [ ] Use fresh start → verify all personal rules disabled
- [ ] Check confidence score stays < 70% after inconsistent results
- [ ] Verify low-confidence rules stay at nudge

---

## Success Metrics

### From Design Document:
✅ **3-Tier Learning**: Pipeline → User → Global
✅ **Progressive Strength**: Nudge → Check → Guard → Law
✅ **Health Bar Decay**: Time + Good Behavior + False Positive
✅ **User Control**: Mute/Delete/Lock/Reset
✅ **Confidence Scoring**: Blocks inconsistent rules
✅ **Context Specificity**: Conditional rule triggers

### Observable Behaviors:
- Rules start weak and only strengthen with repeated violations
- Unused rules naturally decay and disappear
- Bad rules (false positives) die quickly
- Users can take control with mute/lock/delete
- Low-confidence rules never become blocking
- Fresh start clears personal rules but keeps globals

---

## Architecture Alignment with Design

| Design Requirement | Implementation | Status |
|-------------------|----------------|--------|
| Pipeline-Level Learning | ✅ qa_pipeline_instance_rules table | Complete |
| User-Level Learning | ✅ qa_policy_rules with scope filtering | Complete |
| Global-Level Learning | ✅ qa_policy_rules with scope='global' | Complete |
| Progressive Strength (4 stages) | ✅ strength_stage column + UI | Complete |
| Health Bar System | ✅ health column + decay functions | Complete |
| Time Decay | ✅ applyTimeDecay() cron job | Complete |
| Good Behavior Decay | ✅ applyGoodBehaviorDecay() | Complete |
| False Positive Decay | ✅ applyFalsePositiveDecay() | Complete |
| Confidence Scoring | ✅ Calculated from trigger history | Complete |
| User Dashboard | ✅ QALearningDashboard component | Complete |
| Override Tracking | ✅ qa_rule_overrides table | Complete |
| Fresh Start | ✅ resetUserLearningProfile() | Complete |
| Context Specificity | ✅ context_conditions JSONB | Complete |

---

## Implementation Complete ✅

The progressive QA learning system is now fully implemented with:

1. **Smart Learning**: Three tiers that prevent over-restriction
2. **Progressive Strength**: Rules start weak and only strengthen with proof
3. **Natural Decay**: Unused and bad rules die automatically
4. **User Control**: Full transparency and override capabilities
5. **Confidence Protection**: Inconsistent rules can't block work

The system balances learning from mistakes while avoiding the trap of becoming too rigid. Users stay in control while benefiting from intelligent automation.
