/**
 * Progressive QA Learning System
 *
 * Implements three-tier learning with progressive rule strength and health decay.
 * Based on qa_learning_system_design.md.resolved
 */

// ============================================================================
// TYPES
// ============================================================================

export type LearningLevel = "pipeline" | "user" | "global";
export type StrengthStage = "nudge" | "check" | "guard" | "law";

export interface PipelineInstanceRule {
  id: string;
  pipeline_id: string;
  owner_id: string;
  step_id: number;
  category: string;
  rule_text: string;
  trigger_count: number;
  first_triggered_at: string;
  last_triggered_at: string;
}

export interface PolicyRuleExtended {
  id: string;
  owner_id: string;
  scope_level: "global" | "project" | "step";
  step_id: number | null;
  category: string;
  rule_text: string;
  rule_status: "active" | "pending" | "disabled";
  support_count: number;
  violation_count: number;
  escalation_level: "body" | "critical" | "system";
  // Progressive learning fields
  strength_stage: StrengthStage;
  health: number; // 0-100
  confidence_score: number; // 0-1
  context_conditions: Record<string, unknown> | null;
  triggered_count: number;
  approved_despite_trigger: number;
  rejected_due_to_trigger: number;
  user_muted: boolean;
  user_locked: boolean;
  last_triggered_at: string | null;
  last_health_decay_at: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Strength stage thresholds (how many violations to reach each stage)
export const STRENGTH_THRESHOLDS = {
  nudge: 1,    // 1-2 violations
  check: 3,    // 3-5 violations
  guard: 6,    // 6+ violations
  law: Infinity, // Manually promoted by admin
};

// Health decay rates (per day)
export const HEALTH_DECAY = {
  TIME_DECAY_PER_DAY: 2,           // Automatic daily decay
  GOOD_BEHAVIOR_DECAY: 5,          // When task completes without triggering
  FALSE_POSITIVE_DECAY: 30,        // When rule triggers but QA approves anyway
};

// Confidence thresholds
export const CONFIDENCE_THRESHOLD = {
  MIN_FOR_BLOCKING: 0.7,  // Below this, rule stays at "nudge"
  MIN_SAMPLE_SIZE: 5,     // Need at least 5 triggers to calculate confidence
};

// ============================================================================
// LEVEL 1: PIPELINE INSTANCE RULES (Temporary)
// ============================================================================

/**
 * Track a rule violation within the current pipeline instance
 * These rules are temporary and cleared when pipeline completes
 */
export async function trackPipelineInstanceRule(
  supabase: any,
  pipelineId: string,
  ownerId: string,
  stepId: number,
  category: string,
  ruleText: string
): Promise<PipelineInstanceRule | null> {
  // Check if rule already exists for this pipeline
  const { data: existing } = await supabase
    .from("qa_pipeline_instance_rules")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("step_id", stepId)
    .eq("category", category)
    .eq("rule_text", ruleText)
    .single();

  if (existing) {
    // Increment trigger count
    const { data: updated } = await supabase
      .from("qa_pipeline_instance_rules")
      .update({
        trigger_count: existing.trigger_count + 1,
        last_triggered_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    console.log(`[Pipeline Rule] Triggered ${updated.trigger_count}x: "${ruleText}"`);
    return updated;
  } else {
    // Create new instance rule
    const { data: created } = await supabase
      .from("qa_pipeline_instance_rules")
      .insert({
        pipeline_id: pipelineId,
        owner_id: ownerId,
        step_id: stepId,
        category: category,
        rule_text: ruleText,
        trigger_count: 1,
      })
      .select()
      .single();

    console.log(`[Pipeline Rule] Created: "${ruleText}"`);
    return created;
  }
}

/**
 * Get active pipeline instance rules
 * Returns rules that have been triggered 2+ times (showing learning)
 */
export async function getPipelineInstanceRules(
  supabase: any,
  pipelineId: string,
  stepId: number
): Promise<PipelineInstanceRule[]> {
  const { data: rules } = await supabase
    .from("qa_pipeline_instance_rules")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("step_id", stepId)
    .gte("trigger_count", 2) // Only show if triggered 2+ times
    .order("trigger_count", { ascending: false });

  return rules || [];
}

/**
 * Check if error should be promoted from pipeline-level to user-level
 * Trigger: Same error across 3 different pipelines
 */
export async function checkForUserLevelPromotion(
  supabase: any,
  ownerId: string,
  stepId: number,
  category: string,
  ruleText: string
): Promise<boolean> {
  // Count how many different pipelines had this rule
  const { data: pipelines } = await supabase
    .from("qa_pipeline_instance_rules")
    .select("pipeline_id")
    .eq("owner_id", ownerId)
    .eq("step_id", stepId)
    .eq("category", category)
    .eq("rule_text", ruleText);

  const uniquePipelines = new Set((pipelines || []).map(p => p.pipeline_id));
  const shouldPromote = uniquePipelines.size >= 3;

  if (shouldPromote) {
    console.log(`[Learning] Promoting to User Level: "${ruleText}" (${uniquePipelines.size} pipelines)`);
  }

  return shouldPromote;
}

// ============================================================================
// PROGRESSIVE STRENGTH SYSTEM
// ============================================================================

/**
 * Calculate appropriate strength stage based on violation count
 */
export function calculateStrengthStage(violationCount: number, confidenceScore: number): StrengthStage {
  // Low confidence rules never become blocking
  if (confidenceScore < CONFIDENCE_THRESHOLD.MIN_FOR_BLOCKING) {
    return "nudge";
  }

  if (violationCount >= STRENGTH_THRESHOLDS.guard) {
    return "guard";
  } else if (violationCount >= STRENGTH_THRESHOLDS.check) {
    return "check";
  } else {
    return "nudge";
  }
}

/**
 * Update rule strength based on new violation
 */
export async function updateRuleStrength(
  supabase: any,
  ruleId: string,
  currentRule: PolicyRuleExtended
): Promise<void> {
  const newViolationCount = currentRule.violation_count + 1;
  const newStrengthStage = calculateStrengthStage(newViolationCount, currentRule.confidence_score);

  // Only update if stage changed
  if (newStrengthStage !== currentRule.strength_stage) {
    await supabase
      .from("qa_policy_rules")
      .update({
        strength_stage: newStrengthStage,
        violation_count: newViolationCount,
        last_triggered_at: new Date().toISOString(),
      })
      .eq("id", ruleId);

    console.log(`[Strength] Rule "${currentRule.rule_text}" promoted: ${currentRule.strength_stage} → ${newStrengthStage}`);
  }
}

// ============================================================================
// HEALTH BAR & DECAY SYSTEM
// ============================================================================

/**
 * Apply time decay to all active rules
 * Should be run daily via cron job
 */
export async function applyTimeDe cay(supabase: any): Promise<void> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Get rules that haven't been decayed in 24+ hours
  const { data: rules } = await supabase
    .from("qa_policy_rules")
    .select("*")
    .eq("rule_status", "active")
    .eq("user_muted", false)
    .lt("last_health_decay_at", oneDayAgo.toISOString());

  if (!rules || rules.length === 0) return;

  for (const rule of rules) {
    const newHealth = Math.max(0, rule.health - HEALTH_DECAY.TIME_DECAY_PER_DAY);

    // Demote strength stage if health gets low
    let newStrengthStage = rule.strength_stage;
    if (newHealth <= 30 && rule.strength_stage === "guard") {
      newStrengthStage = "check";
    } else if (newHealth <= 15 && rule.strength_stage === "check") {
      newStrengthStage = "nudge";
    }

    // If health reaches 0, disable rule
    const newStatus = newHealth === 0 ? "disabled" : rule.rule_status;

    await supabase
      .from("qa_policy_rules")
      .update({
        health: newHealth,
        strength_stage: newStrengthStage,
        rule_status: newStatus,
        last_health_decay_at: now.toISOString(),
      })
      .eq("id", rule.id);

    if (newHealth === 0) {
      console.log(`[Health] Rule died: "${rule.rule_text}"`);
    } else if (newStrengthStage !== rule.strength_stage) {
      console.log(`[Health] Rule weakened: "${rule.rule_text}" (${rule.strength_stage} → ${newStrengthStage})`);
    }
  }

  console.log(`[Health] Applied time decay to ${rules.length} rules`);
}

/**
 * Apply good behavior decay when task completes without triggering rule
 */
export async function applyGoodBehaviorDecay(
  supabase: any,
  ownerId: string,
  stepId: number,
  completedPipelineId: string
): Promise<void> {
  // Get rules that were NOT triggered in this pipeline
  const { data: activeRules } = await supabase
    .from("qa_policy_rules")
    .select("id, rule_text, health, strength_stage")
    .eq("owner_id", ownerId)
    .eq("step_id", stepId)
    .eq("rule_status", "active")
    .eq("user_locked", false);

  if (!activeRules || activeRules.length === 0) return;

  // Check which rules were triggered
  const { data: triggeredRules } = await supabase
    .from("qa_pipeline_instance_rules")
    .select("rule_text")
    .eq("pipeline_id", completedPipelineId)
    .eq("step_id", stepId);

  const triggeredTexts = new Set((triggeredRules || []).map(r => r.rule_text));

  // Apply decay to non-triggered rules
  for (const rule of activeRules) {
    if (!triggeredTexts.has(rule.rule_text)) {
      const newHealth = Math.max(0, rule.health - HEALTH_DECAY.GOOD_BEHAVIOR_DECAY);

      await supabase
        .from("qa_policy_rules")
        .update({ health: newHealth })
        .eq("id", rule.id);

      console.log(`[Health] Good behavior decay: "${rule.rule_text}" (health: ${rule.health} → ${newHealth})`);
    }
  }
}

/**
 * Apply false positive decay when rule triggers but QA approves anyway
 */
export async function applyFalsePositiveDecay(
  supabase: any,
  ruleId: string,
  currentRule: PolicyRuleExtended
): Promise<void> {
  const newHealth = Math.max(0, currentRule.health - HEALTH_DECAY.FALSE_POSITIVE_DECAY);

  // False positives severely damage confidence
  const newApprovedCount = currentRule.approved_despite_trigger + 1;
  const totalTriggers = currentRule.triggered_count + 1;
  const newConfidence = 1 - (newApprovedCount / totalTriggers);

  await supabase
    .from("qa_policy_rules")
    .update({
      health: newHealth,
      confidence_score: newConfidence,
      approved_despite_trigger: newApprovedCount,
      triggered_count: totalTriggers,
    })
    .eq("id", ruleId);

  console.log(`[Health] False positive decay: "${currentRule.rule_text}" (health: ${currentRule.health} → ${newHealth}, confidence: ${newConfidence.toFixed(2)})`);
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

/**
 * Calculate confidence score based on consistency
 * High confidence = rule consistently predicts rejections
 * Low confidence = inconsistent (sometimes approved, sometimes rejected)
 */
export function calculateConfidenceScore(
  triggeredCount: number,
  approvedDespiteTrigger: number,
  rejectedDueToTrigger: number
): number {
  if (triggeredCount < CONFIDENCE_THRESHOLD.MIN_SAMPLE_SIZE) {
    return 1.0; // Assume confident until proven otherwise
  }

  // Confidence = (correct predictions) / (total triggers)
  const correctPredictions = rejectedDueToTrigger;
  const confidence = correctPredictions / triggeredCount;

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Update confidence score after QA result
 */
export async function updateConfidenceScore(
  supabase: any,
  ruleId: string,
  qaApproved: boolean
): Promise<void> {
  const { data: rule } = await supabase
    .from("qa_policy_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (!rule) return;

  const newTriggeredCount = rule.triggered_count + 1;
  const newApprovedDespite = qaApproved ? rule.approved_despite_trigger + 1 : rule.approved_despite_trigger;
  const newRejectedDue = !qaApproved ? rule.rejected_due_to_trigger + 1 : rule.rejected_due_to_trigger;

  const newConfidence = calculateConfidenceScore(
    newTriggeredCount,
    newApprovedDespite,
    newRejectedDue
  );

  await supabase
    .from("qa_policy_rules")
    .update({
      triggered_count: newTriggeredCount,
      approved_despite_trigger: newApprovedDespite,
      rejected_due_to_trigger: newRejectedDue,
      confidence_score: newConfidence,
    })
    .eq("id", ruleId);

  console.log(`[Confidence] Rule "${rule.rule_text}": ${rule.confidence_score.toFixed(2)} → ${newConfidence.toFixed(2)}`);
}

// ============================================================================
// USER CONTROLS
// ============================================================================

/**
 * Record a rule override (user clicked "Proceed Anyway")
 */
export async function recordRuleOverride(
  supabase: any,
  ruleId: string,
  pipelineId: string,
  ownerId: string,
  stepId: number,
  strengthStage: StrengthStage,
  overrideReason: string | null
): Promise<void> {
  await supabase
    .from("qa_rule_overrides")
    .insert({
      rule_id: ruleId,
      pipeline_id: pipelineId,
      owner_id: ownerId,
      step_id: stepId,
      override_reason: overrideReason,
      rule_strength_stage: strengthStage,
    });

  console.log(`[Override] User overrode ${strengthStage} rule: ${ruleId}`);
}

/**
 * Reset user's learning profile (Fresh Start)
 */
export async function resetUserLearningProfile(
  supabase: any,
  userId: string
): Promise<void> {
  // Disable all user-level rules (scope_level = 'step' or 'project')
  await supabase
    .from("qa_policy_rules")
    .update({ rule_status: "disabled" })
    .eq("owner_id", userId)
    .in("scope_level", ["step", "project"]);

  // Update profile timestamp
  await supabase
    .from("qa_user_learning_profile")
    .upsert({
      user_id: userId,
      last_profile_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  console.log(`[Reset] User ${userId} reset their learning profile`);
}
