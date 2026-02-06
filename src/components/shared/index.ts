/**
 * Shared components - SINGLE SOURCE OF TRUTH
 * 
 * QA Components:
 * - QAScoreInput: Standalone numeric score input (0-100)
 * - QAReviewPanel: Full QA panel with score + approve/reject
 * - QAReviewInline: Compact inline version for lists/tables
 * - QAScoreSave: Score-only input with save (for adding user score to AI decisions)
 * - QAJudgeResultDisplay: Display QA judge results with reasons and rules
 * - QAJudgeResultsList: List of multiple QA judge results
 * - QAJudgeSummaryBadge: Compact summary badge for QA status
 */

export { 
  QAScoreInput,
  QAReviewPanel, 
  QAReviewInline,
  QAScoreSave,
} from "./QAReviewPanel";

export {
  QAJudgeResultDisplay,
  QAJudgeResultsList,
  QAJudgeSummaryBadge,
} from "./QAJudgeResultDisplay";

export type { 
  QAReviewPanelProps,
  QAScoreSaveProps,
} from "./QAReviewPanel";
