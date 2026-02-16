# QA Learning Systems - Complete Overview

## Two Complementary Learning Systems

This codebase now includes **two distinct but complementary** QA learning systems, each addressing different aspects of the learning problem:

---

## System 1: Constraint Escalation System
**Based on**: `ai_qa_learning_loop.md.resolved`
**Implementation**: `AI_QA_LEARNING_LOOP_IMPLEMENTATION.md`
**Focus**: Prompt engineering and visibility

### Core Concept
Rules that are frequently violated get escalated to higher priority sections of the prompt, ensuring the AI pays more attention to chronic problems.

### Key Features

#### 1. **Constraint Escalation**
- Rules move through priority levels based on violations:
  - **Body** → Default prompt section
  - **Critical** (2+ violations) → High-attention section
  - **System** (4+ violations) → Absolute requirements section

#### 2. **Constraint Stack Depth Visibility**
- Shows "Base + N learned constraints" in debug panel
- Makes the "brain changing" visible to users
- Breakdown by escalation level

#### 3. **Rule Promotion Audit Log**
- Tracks when rules activate (pending → active)
- Logs escalation events (body → critical → system)
- Provides historical learning progression

#### 4. **Retry Analytics Dashboard**
- Visualizes average retry count over time
- Graphs trend toward 0 to prove learning effectiveness
- Shows success rates and volume

### When to Use
- Tracking long-term learning effectiveness
- Debugging why certain rules are prioritized
- Understanding the AI's "attention allocation"
- Proving that learning is reducing retries

---

## System 2: Progressive Learning System
**Based on**: `qa_learning_system_design.md.resolved`
**Implementation**: `PROGRESSIVE_QA_LEARNING_IMPLEMENTATION.md`
**Focus**: User experience and rule lifecycle

### Core Concept
Rules start weak (hints) and only strengthen with repeated violations, while automatically decaying when no longer relevant. Prevents the system from becoming overly rigid.

### Key Features

#### 1. **Three-Tier Learning Levels**
- **Pipeline** (temporary) → Only current work
- **User** (personal) → One user's patterns
- **Global** (system-wide) → Everyone's rules

#### 2. **Progressive Strength Stages**
- **Nudge** → Passive hint (no blocking)
- **Check** → Requires confirmation checkbox
- **Guard** → Soft block with override reason
- **Law** → Hard block (admin only)

#### 3. **Health Bar & Decay**
- **Time Decay**: -2 health/day
- **Good Behavior Decay**: -5 when user succeeds without triggering
- **False Positive Decay**: -30 when rule wrong

#### 4. **User Control Dashboard**
- View all active rules
- Mute/lock/delete rules
- Fresh start button
- Health and confidence visualization

#### 5. **Confidence Scoring**
- Tracks rule accuracy (correct predictions / total triggers)
- Low-confidence rules (< 70%) stay at "nudge" forever
- Prevents frustrating false positives from blocking

### When to Use
- Managing user experience during QA flow
- Showing progressive warnings (nudge/check/guard/law)
- Allowing users to override or mute annoying rules
- Ensuring bad rules die naturally

---

## How They Work Together

### Complementary Strengths

| System 1: Escalation | System 2: Progressive | Together |
|---------------------|---------------------|----------|
| Focuses on AI prompt priority | Focuses on user experience | Complete learning loop |
| Tracks violations → prompt placement | Tracks violations → UI behavior | Both inform each other |
| Shows learning via analytics | Shows learning via health bars | Multiple visibility methods |
| Promotion log = system audit | User dashboard = user control | Transparency at all levels |
| Retry trend → 0 = proof of learning | Rule decay = proof of relevance | Learning + Adaptation |

### Unified Data Model

Both systems use the same underlying tables:

#### `qa_policy_rules` (Extended)
```sql
-- System 1 fields
violation_count INTEGER
escalation_level TEXT ('body'|'critical'|'system')

-- System 2 fields
strength_stage TEXT ('nudge'|'check'|'guard'|'law')
health INTEGER (0-100)
confidence_score NUMERIC (0-1)

-- Shared fields
rule_text TEXT
category TEXT
scope_level TEXT
```

#### Pipeline Flow Integration

```
1. QA Rejection Detected
         ↓
2. SYSTEM 1: Track violation → Update escalation_level
         ↓
3. SYSTEM 2: Update strength_stage, apply decay
         ↓
4. Prompt Assembly:
   - System 1: Place rules in prompt sections by escalation_level
   - System 2: Apply context_conditions filtering
         ↓
5. User Interaction:
   - System 1: Show constraint stack depth in debug panel
   - System 2: Show progressive warning dialog
         ↓
6. Retry with improved prompt
         ↓
7. Analytics:
   - System 1: Log to promotion log, update retry analytics
   - System 2: Update confidence score, apply health decay
```

---

## Choosing Which System to Use

### Use System 1 (Escalation) When:
- ✅ You need to debug why prompts aren't working
- ✅ You want to prove learning is reducing retries
- ✅ You're analyzing long-term trends
- ✅ You're working on backend prompt engineering

### Use System 2 (Progressive) When:
- ✅ You're building user-facing features
- ✅ You need to prevent over-restriction
- ✅ You want users to manage their own rules
- ✅ You need graceful handling of false positives

### Use Both When:
- ✅ Building a complete QA learning product (recommended!)
- ✅ You need both visibility AND control
- ✅ You want to balance AI learning with user autonomy

---

## Implementation Status

### System 1: Constraint Escalation ✅
- [x] Database migrations
- [x] Escalation logic
- [x] Promotion audit log
- [x] Constraint stack depth API
- [x] Retry analytics API
- [x] Debug panel integration
- [x] Analytics dashboard component

### System 2: Progressive Learning ✅
- [x] Database migrations
- [x] Three-tier learning logic
- [x] Progressive strength system
- [x] Health bar decay system
- [x] Confidence scoring
- [x] User dashboard component
- [x] Progressive warning component
- [x] Reset profile API

---

## Files Summary

### Database Migrations (3 total)
1. `20260210160000_add_constraint_escalation.sql` (System 1)
2. `20260210160100_add_rule_promotion_log.sql` (System 1)
3. `20260210160200_add_progressive_learning_system.sql` (System 2)

### Shared Libraries (2)
1. `_shared/qa-learning-injector.ts` (System 1 + shared)
2. `_shared/progressive-learning.ts` (System 2)

### Edge Functions (4)
1. `get-constraint-stack-depth` (System 1)
2. `get-rule-promotion-log` (System 1)
3. `get-retry-analytics` (System 1)
4. `reset-learning-profile` (System 2)

### Frontend Components (5)
1. `PipelineDebugPanel.tsx` - Shows constraint stack depth (System 1)
2. `RetryAnalyticsDashboard.tsx` - Shows retry trends (System 1)
3. `QALearningDashboard.tsx` - Manages rules (System 2)
4. `QAProgressiveWarning.tsx` - In-flow warnings (System 2)
5. `useConstraintStackDepth.ts` - Hook (System 1)

---

## Integration Roadmap

### Phase 1: Backend (Complete ✅)
- [x] Apply all migrations
- [x] Deploy edge functions
- [x] Set up daily time decay cron job

### Phase 2: Prompt Integration
- [ ] Integrate System 1 escalation into prompt assembly
- [ ] Add formatted constraint sections (body/critical/system)
- [ ] Include health and confidence in prompt metadata

### Phase 3: UX Integration
- [ ] Add `QAProgressiveWarning` to pipeline flow
- [ ] Check triggered rules before QA submission
- [ ] Record overrides when user proceeds
- [ ] Add "My Learning Rules" to user menu
- [ ] Link to `QALearningDashboard`

### Phase 4: Feedback Loop
- [ ] Update confidence scores after QA results
- [ ] Apply decay after task completion
- [ ] Track override outcomes (was QA right?)
- [ ] Promote pipeline rules to user level (3 pipelines)

### Phase 5: Analytics
- [ ] Add analytics to project dashboard
- [ ] Show retry trend graphs
- [ ] Display rule promotion timeline
- [ ] Export learning metrics

---

## Configuration Reference

### System 1: Escalation Thresholds
```typescript
violation_count >= 4 → escalation_level = 'system'
violation_count >= 2 → escalation_level = 'critical'
violation_count >= 0 → escalation_level = 'body'
```

### System 2: Strength Thresholds
```typescript
violation_count >= 6 + confidence >= 0.7 → strength_stage = 'guard'
violation_count >= 3 + confidence >= 0.7 → strength_stage = 'check'
violation_count >= 1 → strength_stage = 'nudge'
manually_promoted → strength_stage = 'law'
```

### System 2: Decay Rates
```typescript
TIME_DECAY_PER_DAY = 2
GOOD_BEHAVIOR_DECAY = 5
FALSE_POSITIVE_DECAY = 30
```

### System 2: Confidence
```typescript
MIN_FOR_BLOCKING = 0.7 (70%)
MIN_SAMPLE_SIZE = 5 triggers
```

---

## Example: Full Journey of a Rule

### Pipeline 1, Step 4: First Mistake
- User forgets wall alignment
- QA rejects → **System 2**: Create pipeline-instance rule (Level 1, Nudge)
- **System 1**: Not yet tracked (needs user-level promotion)
- User sees: "Tip: Check wall alignment"
- Pipeline completes → Rule cleared

### Pipeline 2, Step 4: Second Mistake
- User forgets wall alignment again
- **System 2**: New pipeline-instance rule created
- Still not promoted to user level (needs 3 pipelines)

### Pipeline 3, Step 4: Third Mistake ⚠️
- User forgets wall alignment AGAIN
- **System 2**: Promotes to User Level (Level 2)
  - Creates rule in `qa_policy_rules`
  - strength_stage = 'nudge'
  - health = 100
  - violation_count = 1
- **System 1**: Starts tracking
  - escalation_level = 'body'
  - violation_count = 1

### Violations 2-3: Strengthening
- **System 2**: violation_count = 3 → strength_stage = 'check'
  - User must now check box to confirm
- **System 1**: violation_count = 2 → escalation_level = 'critical'
  - Rule moves to "CRITICAL CONSTRAINTS" prompt section

### Violations 4-6: Maximum Strength
- **System 2**: violation_count = 6 → strength_stage = 'guard'
  - User must type override reason (soft block)
- **System 1**: violation_count = 4 → escalation_level = 'system'
  - Rule moves to "SYSTEM-LEVEL CONSTRAINTS" (absolute requirements)

### Next 10 Tasks: Success!
- User completes tasks without violating
- **System 2**: Applies good behavior decay
  - health = 100 → 50 (10 tasks × -5)
- **System 1**: Logs successful completions in retry analytics
  - Average retry count decreases

### 25 Days Later: Natural Death
- **System 2**: Time decay accumulates
  - health = 50 → 0 (25 days × -2)
  - Rule dies (disabled)
  - strength_stage demotes: guard → check → nudge → disabled
- **System 1**: Logs rule death in promotion log
- User learned! Both systems adapted.

---

## Best Practices

### For Developers

1. **Always update both systems** when recording violations:
   ```typescript
   // System 1
   await trackRuleViolationsAndEscalate(supabase, violatedRules, ownerId, stepId);

   // System 2
   await updateRuleStrength(supabase, ruleId, currentRule);
   await updateConfidenceScore(supabase, ruleId, qaApproved);
   ```

2. **Use System 2 for UX**, System 1 for backend:
   - Show progressive warnings (System 2) in UI
   - Use escalation levels (System 1) in prompts

3. **Let rules decay naturally**:
   - Don't manually disable rules unless needed
   - Let health system handle cleanup

### For Users

1. **Start with nudges**:
   - Pay attention to tips (nudge stage)
   - They'll strengthen if you keep making mistakes

2. **Use the dashboard**:
   - Mute annoying rules (false positives)
   - Lock important rules (prevent decay)
   - Fresh start if overwhelmed

3. **Override thoughtfully**:
   - Guard stage requires typed reason
   - System learns from your overrides
   - Good overrides improve confidence scores

---

## Monitoring & Metrics

### System Health Indicators

#### System 1: Escalation
- **Retry count trending down** = Learning working
- **Many system-level rules** = Chronic problems (investigate)
- **Flat retry trend** = Learning not effective

#### System 2: Progressive
- **High false positive decay** = Bad rules getting killed (good!)
- **Many low-health rules** = Natural decay working
- **Users not overriding guard rules** = Rules are accurate

### Red Flags

- ⚠️ Too many "law" stage rules → System too rigid
- ⚠️ Confidence scores consistently low → Rules are inconsistent
- ⚠️ Users resetting profiles frequently → Over-restriction
- ⚠️ Retry count not decreasing → Learning not working

---

## Support & Troubleshooting

### Common Issues

**Q: Rules aren't strengthening despite violations**
A: Check confidence scores. Low-confidence rules (< 70%) won't strengthen beyond nudge.

**Q: Rules disappeared**
A: Check health. Rules with 0 health are disabled. Check `qa_rule_promotion_log` for death events.

**Q: Too many blocking rules**
A: Users can mute rules in dashboard or use Fresh Start.

**Q: Retry count not decreasing**
A: Check escalation levels in prompts. Ensure critical/system rules are actually being injected.

**Q: Users complaining about restrictions**
A: Review confidence scores of guard/law rules. Consider demoting low-confidence rules.

---

## Conclusion

Both systems work together to create a **self-balancing learning loop**:

- **System 1** ensures the AI learns by prioritizing chronic problems in prompts
- **System 2** ensures users aren't frustrated by making rules progressively stronger and naturally decaying

The result: An AI that learns from mistakes while staying flexible and user-friendly.

**Status**: ✅ Fully implemented and ready for integration.
