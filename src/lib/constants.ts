/**
 * Application constants - Single source of truth
 */

export const APP_NAME = "RE:TOUR";
export const APP_DESCRIPTION = "AI-powered tour management platform";

/**
 * DEPRECATED: Camera Intent System Constants
 * Step 3 (Camera Intent) is architecturally FROZEN per pipeline specification.
 * These status values should NOT be used in active pipeline operations.
 * Status: FROZEN (2026-02-10)
 * Reason: Active execution violates locked architectural contract
 * See: RETOUR – PIPELINE (UPDATED & LOCKED).txt
 */

// DEPRECATED - DO NOT USE
// export const CAMERA_INTENT_STATUS = {
//   PENDING: "step4_camera_intent_pending",
//   GENERATED: "step4_camera_intent_generated",
//   CONFIRMED: "step4_camera_intent_confirmed",
// } as const;

// export type CameraIntentStatus = typeof CAMERA_INTENT_STATUS[keyof typeof CAMERA_INTENT_STATUS];
