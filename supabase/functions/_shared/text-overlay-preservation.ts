/**
 * TEXT OVERLAY PRESERVATION CONSTRAINTS
 * 
 * This module enforces strict preservation of original room labels/text overlays
 * across Steps 0-5 of the Whole Apartment Pipeline.
 * 
 * The AI model MUST NOT:
 * - Remove any existing text labels
 * - Add any new text/labels
 * - Edit, rewrite, or translate labels
 * - Change font, size, color, or position of labels
 * 
 * QA validation checks specifically for text overlay compliance.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT INJECTION BLOCK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Text preservation constraint block to inject into generation prompts.
 * This MUST be injected into ALL generation prompts for Steps 0-5.
 */
export const TEXT_OVERLAY_PRESERVATION_BLOCK = `
═══════════════════════════════════════════════════════════════════════════
TEXT & LABEL PRESERVATION (MANDATORY - Steps 0-5)
═══════════════════════════════════════════════════════════════════════════

CRITICAL: The original floor plan contains room name labels/text overlays.
These labels MUST be preserved EXACTLY as they appear in the source image.

MANDATORY RULES:
1. KEEP ALL EXISTING ROOM NAME TEXT OVERLAYS EXACTLY THE SAME
2. DO NOT REMOVE ANY TEXT
3. DO NOT ADD ANY NEW TEXT OR LABELS
4. DO NOT EDIT, REWRITE, OR TRANSLATE ANY LABELS
5. DO NOT CHANGE FONT, SIZE, COLOR, OR POSITION OF ANY TEXT
6. PRESERVE THE ORIGINAL LABELS AS-IS

WHAT TO PRESERVE:
- Room names (e.g., "Living Room", "Bedroom", "Kitchen", "Bathroom")
- Space labels (e.g., "Closet", "Balcony", "Storage")
- Any text annotations visible on the original floor plan
- Exact spelling, language, capitalization
- Exact position and orientation of each label

WHAT IS FORBIDDEN:
❌ Removing any visible text/labels
❌ Moving text to a different position
❌ Translating text to another language
❌ Changing font style, size, or weight
❌ Changing text color or opacity
❌ Adding new decorative text or captions
❌ Adding model-generated watermarks or signatures
❌ Replacing room names with different terminology

The final output MUST display all original room name labels in their exact
original positions, styles, and content.
═══════════════════════════════════════════════════════════════════════════
`;

/**
 * Compact version of text preservation constraints for prompts with tight token limits
 */
export const TEXT_OVERLAY_PRESERVATION_COMPACT = `
TEXT PRESERVATION (MANDATORY):
- KEEP all original room name labels exactly as shown
- DO NOT remove, add, edit, translate, or move any text
- DO NOT change font, size, color, or position
- Preserve exact spelling, language, and capitalization
`;

// ═══════════════════════════════════════════════════════════════════════════
// QA VALIDATION PROMPT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * QA prompt section for text overlay validation
 * This is injected into QA checks for Steps 0-5
 */
export const TEXT_OVERLAY_QA_PROMPT = `
═══════════════════════════════════════════════════════════════════════════
TEXT OVERLAY PRESERVATION CHECK (MANDATORY)
═══════════════════════════════════════════════════════════════════════════

Compare the ORIGINAL floor plan image with the GENERATED output image.
Verify that ALL room name labels and text overlays are preserved correctly.

CHECK CRITERIA:

1. PRESENCE CHECK - Every original label must still exist:
   - Count visible labels in original
   - Count visible labels in generated output
   - Identify any MISSING labels

2. NO ADDITIONS CHECK - No new text should appear:
   - Look for any text not in original
   - Flag any added captions, watermarks, or decorative text

3. NO EDITS CHECK - Labels must be identical:
   - Compare exact spelling of each label
   - Check for translations or rewording
   - Verify language hasn't changed

4. POSITION CHECK - Labels must be in same locations:
   - Check each label's relative position
   - Flag any noticeable movement or shift

FAILURE CRITERIA (any of these = FAIL):
- One or more labels are missing
- One or more labels have different text
- One or more labels have moved noticeably
- New text/labels have been added
- Font, color, or size has changed significantly

PASS CRITERIA:
- All original labels are present
- All labels have identical text content
- All labels are in their original positions
- No new text has been added

OUTPUT FORMAT:
If text preservation FAILS, include in your response:
{
  "text_overlay_check": {
    "passed": false,
    "missing_labels": ["Label1", "Label2"],
    "changed_labels": [{"original": "Kitchen", "new": "Cuisine"}],
    "added_labels": ["Watermark text"],
    "moved_labels": ["Living Room - shifted left"],
    "summary": "One-sentence summary of text preservation issues"
  }
}

If text preservation PASSES:
{
  "text_overlay_check": {
    "passed": true,
    "labels_verified_count": 8,
    "summary": "All 8 room labels preserved exactly as original"
  }
}
═══════════════════════════════════════════════════════════════════════════
`;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines if text preservation constraints should be applied to GENERATION prompts.
 * 
 * TEXT PRESERVATION IS REQUIRED FOR GENERATION IN STEPS 0-5:
 * - Step 0: Space Analysis (preserve labels for room identification)
 * - Step 1: Top-Down 3D (MUST preserve room labels in generation - user requirement)
 * - Steps 2-5: Style and render steps (preserve labels for consistency)
 * 
 * Returns false for Steps 6, 7 and any steps outside 0-7 range.
 * 
 * IMPORTANT: This is for GENERATION prompts. For QA validation, use 
 * shouldApplyTextPreservationForQA() instead.
 */
export function shouldApplyTextPreservationForGeneration(stepNumber: number): boolean {
  // Apply text preservation to Steps 0-5 for generation (includes Step 1)
  return stepNumber >= 0 && stepNumber <= 5;
}

/**
 * Determines if text preservation should be CHECKED during QA validation.
 * 
 * QA EXEMPTION for Step 1:
 * - Step 1 (Floor Plan → Top-Down 3D): QA must IGNORE text completely.
 *   QA focuses on structural fidelity, furniture scale, and layout correctness.
 *   The generation is instructed to preserve text, but QA doesn't validate it.
 * 
 * QA CHECKS TEXT for Steps 0, 2-5.
 * 
 * Returns false for Steps 1, 6, 7 and any steps outside 0-7 range.
 */
export function shouldApplyTextPreservationForQA(stepNumber: number): boolean {
  // Exclude Step 1 from QA text checks - QA must ignore text for Step 1
  if (stepNumber === 1) {
    return false;
  }
  // Apply QA text checks to Steps 0, 2, 3, 4, 5 only
  return stepNumber >= 0 && stepNumber <= 5;
}

/**
 * Legacy function - kept for backwards compatibility.
 * Now uses the QA version (excludes Step 1) to maintain existing behavior.
 * @deprecated Use shouldApplyTextPreservationForGeneration() or shouldApplyTextPreservationForQA()
 */
export function shouldApplyTextPreservation(stepNumber: number): boolean {
  return shouldApplyTextPreservationForQA(stepNumber);
}

/**
 * Injects text preservation constraints into a GENERATION prompt.
 * This applies to Steps 0-5 INCLUDING Step 1.
 * @param prompt The base prompt
 * @param stepNumber The current step number
 * @param useCompact Whether to use the compact version (for token-limited prompts)
 */
export function injectTextPreservationForGeneration(
  prompt: string,
  stepNumber: number,
  useCompact: boolean = false
): string {
  if (!shouldApplyTextPreservationForGeneration(stepNumber)) {
    return prompt;
  }
  
  const block = useCompact ? TEXT_OVERLAY_PRESERVATION_COMPACT : TEXT_OVERLAY_PRESERVATION_BLOCK;
  
  // Inject at the beginning of the prompt for maximum visibility
  return `${block}\n\n${prompt}`;
}

/**
 * Legacy function for backwards compatibility - uses QA rules (excludes Step 1).
 * @deprecated Use injectTextPreservationForGeneration() for generation prompts
 */
export function injectTextPreservation(
  prompt: string,
  stepNumber: number,
  useCompact: boolean = false
): string {
  if (!shouldApplyTextPreservationForQA(stepNumber)) {
    return prompt;
  }
  
  const block = useCompact ? TEXT_OVERLAY_PRESERVATION_COMPACT : TEXT_OVERLAY_PRESERVATION_BLOCK;
  
  // Inject at the beginning of the prompt for maximum visibility
  return `${block}\n\n${prompt}`;
}

/**
 * Gets the QA validation prompt section for text overlay checks.
 * Only returns content for Steps 0, 2-5 (EXCLUDES Step 1).
 * Step 1 QA must ignore text completely.
 */
export function getTextOverlayQASection(stepNumber: number): string {
  if (!shouldApplyTextPreservationForQA(stepNumber)) {
    return "";
  }
  return TEXT_OVERLAY_QA_PROMPT;
}

// ═══════════════════════════════════════════════════════════════════════════
// QA RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TextOverlayCheckResult {
  passed: boolean;
  labels_verified_count?: number;
  missing_labels?: string[];
  changed_labels?: Array<{ original: string; new: string }>;
  added_labels?: string[];
  moved_labels?: string[];
  summary: string;
}

/**
 * Parse text overlay check result from QA response
 */
export function parseTextOverlayCheck(qaResponse: Record<string, unknown>): TextOverlayCheckResult | null {
  const check = qaResponse.text_overlay_check;
  if (!check || typeof check !== "object") {
    return null;
  }
  
  const result = check as Record<string, unknown>;
  return {
    passed: result.passed === true,
    labels_verified_count: typeof result.labels_verified_count === "number" ? result.labels_verified_count : undefined,
    missing_labels: Array.isArray(result.missing_labels) ? result.missing_labels as string[] : undefined,
    changed_labels: Array.isArray(result.changed_labels) ? result.changed_labels as Array<{ original: string; new: string }> : undefined,
    added_labels: Array.isArray(result.added_labels) ? result.added_labels as string[] : undefined,
    moved_labels: Array.isArray(result.moved_labels) ? result.moved_labels as string[] : undefined,
    summary: typeof result.summary === "string" ? result.summary : "Text overlay check result unavailable",
  };
}

/**
 * Build a detailed QA failure reason from text overlay check results
 */
export function buildTextOverlayFailureReason(check: TextOverlayCheckResult): string {
  const parts: string[] = [];
  
  if (check.missing_labels && check.missing_labels.length > 0) {
    parts.push(`Missing label(s): ${check.missing_labels.join(", ")}`);
  }
  
  if (check.changed_labels && check.changed_labels.length > 0) {
    const changes = check.changed_labels.map(c => `"${c.original}" → "${c.new}"`).join(", ");
    parts.push(`Changed label(s): ${changes}`);
  }
  
  if (check.added_labels && check.added_labels.length > 0) {
    parts.push(`Extra label(s) added: ${check.added_labels.join(", ")}`);
  }
  
  if (check.moved_labels && check.moved_labels.length > 0) {
    parts.push(`Moved label(s): ${check.moved_labels.join(", ")}`);
  }
  
  if (parts.length === 0) {
    return check.summary || "Text overlay preservation failed";
  }
  
  return parts.join("; ");
}
