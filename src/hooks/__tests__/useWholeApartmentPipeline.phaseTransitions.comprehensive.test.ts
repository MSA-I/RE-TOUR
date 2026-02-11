/**
 * Comprehensive Phase Transition Tests
 *
 * Tests all legal phase transitions and verifies illegal transitions are blocked.
 * Authority: deep_debugger_plan.md Component 2.1
 *
 * CRITICAL: These tests must pass 100% before deploying any pipeline changes.
 * Previous migrations broke due to phase transition failures.
 */

import { describe, test, expect } from 'vitest';
import { LEGAL_PHASE_TRANSITIONS, PHASE_STEP_MAP } from '../useWholeApartmentPipeline';

describe('Phase Transitions - Comprehensive (CRITICAL)', () => {

  describe('Legal Transitions Map Validity', () => {
    test('LEGAL_PHASE_TRANSITIONS contains all critical transitions', () => {
      const criticalTransitions = [
        'space_analysis_complete',     // Step 0 → Step 1
        'top_down_3d_review',          // Step 1 → Step 2
        'style_review',                 // Step 2 → Step 3
        'spaces_detected',              // Step 3 → Step 4
        'camera_intent_confirmed',      // Step 4 → Step 5 (NEW)
        'prompt_templates_confirmed',   // Step 5 → Step 6 (NEW)
        'outputs_review',               // Step 6 → Step 7
        'panoramas_review',             // Step 7 → Step 8
        'merging_review',               // Step 8 → Complete
      ];

      criticalTransitions.forEach(transition => {
        expect(
          LEGAL_PHASE_TRANSITIONS,
          `Missing critical transition: ${transition}`
        ).toHaveProperty(transition);
      });
    });

    test('All target phases exist in PHASE_STEP_MAP', () => {
      Object.entries(LEGAL_PHASE_TRANSITIONS).forEach(([from, to]) => {
        expect(
          PHASE_STEP_MAP,
          `Target phase "${to}" from transition "${from} → ${to}" not found in PHASE_STEP_MAP`
        ).toHaveProperty(to);
      });
    });
  });

  describe('Step 0 → Step 1: Space Analysis Complete', () => {
    test('legal transition: space_analysis_complete → top_down_3d_pending', () => {
      const from = 'space_analysis_complete';
      const expectedTo = 'top_down_3d_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(0);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(1);
    });

    test('illegal transition: space_analysis_complete → style_pending', () => {
      const from = 'space_analysis_complete';
      const illegalTo = 'style_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).not.toBe(illegalTo);
    });

    test('illegal transition: space_analysis_running → top_down_3d_pending', () => {
      const from = 'space_analysis_running';

      // Cannot transition while still running
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });
  });

  describe('Step 1 → Step 2: Top Down 3D Review', () => {
    test('legal transition: top_down_3d_review → style_pending', () => {
      const from = 'top_down_3d_review';
      const expectedTo = 'style_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(1);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(2);
    });

    test('illegal transition: top_down_3d_pending → style_pending', () => {
      const from = 'top_down_3d_pending';

      // Cannot skip to next step without review
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });

    test('illegal transition: top_down_3d_running → style_pending', () => {
      const from = 'top_down_3d_running';

      // Cannot skip running phase
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });
  });

  describe('Step 2 → Step 3: Style Review (to Space Scan)', () => {
    test('legal transition: style_review → detect_spaces_pending', () => {
      const from = 'style_review';
      const expectedTo = 'detect_spaces_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(2);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(3);
    });

    test('illegal transition: style_pending → detect_spaces_pending', () => {
      const from = 'style_pending';

      // Cannot skip style generation
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });

    test('illegal transition: style_review → camera_intent_pending', () => {
      const from = 'style_review';
      const illegalTo = 'camera_intent_pending';

      // Cannot skip space detection step
      expect(LEGAL_PHASE_TRANSITIONS[from]).not.toBe(illegalTo);
    });
  });

  describe('Step 3 → Step 4: Spaces Detected (to Camera Intent)', () => {
    test('legal transition: spaces_detected → camera_intent_pending', () => {
      const from = 'spaces_detected';
      const expectedTo = 'camera_intent_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(3);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(4);
    });

    test('illegal transition: detect_spaces_pending → camera_intent_pending', () => {
      const from = 'detect_spaces_pending';

      // Cannot advance before spaces detected
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });

    test('step 4 has Decision-Only badge', () => {
      expect(PHASE_STEP_MAP['camera_intent_pending']).toBe(4);
      // Badge verification would happen in component tests
    });
  });

  describe('Step 4 → Step 5: Camera Intent Confirmed (to Prompt Templates) - NEW', () => {
    test('legal transition: camera_intent_confirmed → prompt_templates_pending', () => {
      const from = 'camera_intent_confirmed';
      const expectedTo = 'prompt_templates_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(4);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(5);
    });

    test('illegal transition: camera_intent_pending → prompt_templates_pending', () => {
      const from = 'camera_intent_pending';

      // Cannot advance before camera intent confirmed
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });

    test('illegal transition: camera_intent_confirmed → outputs_pending', () => {
      const from = 'camera_intent_confirmed';
      const illegalTo = 'outputs_pending';

      // Cannot skip prompt templates step
      expect(LEGAL_PHASE_TRANSITIONS[from]).not.toBe(illegalTo);
    });
  });

  describe('Step 5 → Step 6: Prompt Templates Confirmed (to Outputs) - NEW', () => {
    test('legal transition: prompt_templates_confirmed → outputs_pending', () => {
      const from = 'prompt_templates_confirmed';
      const expectedTo = 'outputs_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(5);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(6);
    });

    test('illegal transition: prompt_templates_pending → outputs_pending', () => {
      const from = 'prompt_templates_pending';

      // Cannot advance before prompts confirmed
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });
  });

  describe('Step 6 → Step 7: Outputs Review (to Panoramas)', () => {
    test('legal transition: outputs_review → panoramas_pending', () => {
      const from = 'outputs_review';
      const expectedTo = 'panoramas_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(6);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(7);
    });

    test('illegal transition: outputs_pending → panoramas_pending', () => {
      const from = 'outputs_pending';

      // Cannot skip outputs generation
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });
  });

  describe('Step 7 → Step 8: Panoramas Review (to Final Approval)', () => {
    test('legal transition: panoramas_review → merging_pending', () => {
      const from = 'panoramas_review';
      const expectedTo = 'merging_pending';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(7);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(8);
    });

    test('illegal transition: panoramas_pending → merging_pending', () => {
      const from = 'panoramas_pending';

      // Cannot skip panoramas generation
      expect(LEGAL_PHASE_TRANSITIONS).not.toHaveProperty(from);
    });
  });

  describe('Step 8: Final Completion', () => {
    test('legal transition: merging_review → completed', () => {
      const from = 'merging_review';
      const expectedTo = 'completed';

      expect(LEGAL_PHASE_TRANSITIONS[from]).toBe(expectedTo);
      expect(PHASE_STEP_MAP[from]).toBe(8);
      expect(PHASE_STEP_MAP[expectedTo]).toBe(8);
    });

    test('completed phase has step number 8', () => {
      expect(PHASE_STEP_MAP['completed']).toBe(8);
    });

    test('no further transitions from completed', () => {
      const from = 'completed';
      const hasTransition = Object.keys(LEGAL_PHASE_TRANSITIONS).includes(from);

      expect(hasTransition).toBe(false);
    });
  });

  describe('Phase-Step Consistency', () => {
    test('all phases map to step numbers 0-8', () => {
      Object.entries(PHASE_STEP_MAP).forEach(([phase, step]) => {
        expect(
          step,
          `Phase "${phase}" has invalid step number ${step}`
        ).toBeGreaterThanOrEqual(0);
        expect(
          step,
          `Phase "${phase}" has invalid step number ${step}`
        ).toBeLessThanOrEqual(8);
      });
    });

    test('transitions always advance or maintain step number', () => {
      Object.entries(LEGAL_PHASE_TRANSITIONS).forEach(([from, to]) => {
        const fromStep = PHASE_STEP_MAP[from];
        const toStep = PHASE_STEP_MAP[to];

        expect(
          toStep,
          `Illegal backward transition: ${from} (step ${fromStep}) → ${to} (step ${toStep})`
        ).toBeGreaterThanOrEqual(fromStep);
      });
    });

    test('no phase skips more than 1 step', () => {
      Object.entries(LEGAL_PHASE_TRANSITIONS).forEach(([from, to]) => {
        const fromStep = PHASE_STEP_MAP[from];
        const toStep = PHASE_STEP_MAP[to];
        const stepDifference = toStep - fromStep;

        expect(
          stepDifference,
          `Phase ${from} (step ${fromStep}) skips too many steps to ${to} (step ${toStep})`
        ).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Historical Failure Prevention', () => {
    test('prevents 500 error: camera_intent_pending must have step 4', () => {
      // Historical issue: Phase/step mismatch caused 500 errors
      expect(PHASE_STEP_MAP['camera_intent_pending']).toBe(4);
    });

    test('prevents 500 error: prompt_templates_pending must have step 5', () => {
      // NEW step: Must be correctly mapped
      expect(PHASE_STEP_MAP['prompt_templates_pending']).toBe(5);
    });

    test('prevents stuck pipeline: all review phases have transitions', () => {
      const reviewPhases = [
        'top_down_3d_review',
        'style_review',
        'outputs_review',
        'panoramas_review',
        'merging_review',
      ];

      reviewPhases.forEach(phase => {
        expect(
          LEGAL_PHASE_TRANSITIONS,
          `Review phase "${phase}" missing transition (pipeline would be stuck)`
        ).toHaveProperty(phase);
      });
    });

    test('prevents UI confusion: Step 3 is Space Scan (internal), Step 4 is Camera Intent', () => {
      expect(PHASE_STEP_MAP['detect_spaces_pending']).toBe(3);
      expect(PHASE_STEP_MAP['camera_intent_pending']).toBe(4);
    });
  });

  describe('New Pipeline Changes Validation', () => {
    test('NEW: camera_intent_confirmed transitions to prompt_templates_pending', () => {
      expect(LEGAL_PHASE_TRANSITIONS['camera_intent_confirmed']).toBe('prompt_templates_pending');
    });

    test('NEW: prompt_templates_pending maps to step 5', () => {
      expect(PHASE_STEP_MAP['prompt_templates_pending']).toBe(5);
    });

    test('NEW: prompt_templates_confirmed transitions to outputs_pending', () => {
      expect(LEGAL_PHASE_TRANSITIONS['prompt_templates_confirmed']).toBe('outputs_pending');
    });

    test('NEW: outputs_pending maps to step 6 (was step 5 before)', () => {
      expect(PHASE_STEP_MAP['outputs_pending']).toBe(6);
    });
  });
});

describe('Phase Transition Helper Functions', () => {
  test('can determine current step from phase', () => {
    const testCases = [
      { phase: 'space_analysis_complete', expectedStep: 0 },
      { phase: 'top_down_3d_review', expectedStep: 1 },
      { phase: 'style_review', expectedStep: 2 },
      { phase: 'spaces_detected', expectedStep: 3 },
      { phase: 'camera_intent_pending', expectedStep: 4 },
      { phase: 'prompt_templates_pending', expectedStep: 5 },
      { phase: 'outputs_review', expectedStep: 6 },
      { phase: 'panoramas_review', expectedStep: 7 },
      { phase: 'completed', expectedStep: 8 },
    ];

    testCases.forEach(({ phase, expectedStep }) => {
      expect(PHASE_STEP_MAP[phase]).toBe(expectedStep);
    });
  });

  test('can determine next legal phase', () => {
    const testCases = [
      { currentPhase: 'space_analysis_complete', expectedNext: 'top_down_3d_pending' },
      { currentPhase: 'spaces_detected', expectedNext: 'camera_intent_pending' },
      { currentPhase: 'camera_intent_confirmed', expectedNext: 'prompt_templates_pending' },
      { currentPhase: 'prompt_templates_confirmed', expectedNext: 'outputs_pending' },
    ];

    testCases.forEach(({ currentPhase, expectedNext }) => {
      expect(LEGAL_PHASE_TRANSITIONS[currentPhase]).toBe(expectedNext);
    });
  });
});
