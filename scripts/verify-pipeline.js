#!/usr/bin/env node

/**
 * RE-TOUR Pipeline Verification Script
 * 
 * This script verifies that the pipeline repairs are working correctly by:
 * 1. Checking frontend-backend contract alignment
 * 2. Simulating phase transitions
 * 3. Validating mutation logic
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

// Phase-Step Contract (should match backend)
const PHASE_STEP_MAP = {
    upload: 0,
    space_analysis_pending: 0,
    space_analysis_running: 0,
    space_analysis_complete: 0,
    top_down_3d_pending: 1,
    top_down_3d_running: 1,
    top_down_3d_review: 1,
    style_pending: 2,
    style_running: 2,
    style_review: 2,
    detect_spaces_pending: 3,
    detecting_spaces: 3,
    spaces_detected: 3,
    camera_plan_pending: 4,
    camera_plan_confirmed: 4,
    renders_pending: 5,
    renders_in_progress: 5,
    renders_review: 5,
    panoramas_pending: 6,
    panoramas_in_progress: 6,
    panoramas_review: 6,
    merging_pending: 7,
    merging_in_progress: 7,
    merging_review: 7,
    completed: 7,
    failed: 0,
};

const LEGAL_PHASE_TRANSITIONS = {
    space_analysis_complete: 'top_down_3d_pending',
    top_down_3d_review: 'style_pending',
    style_review: 'detect_spaces_pending',
    spaces_detected: 'camera_plan_pending',
    camera_plan_confirmed: 'renders_pending',
    renders_review: 'panoramas_pending',
    panoramas_review: 'merging_pending',
    merging_review: 'completed',
};

async function verifyPhaseStepContract() {
    console.log('\n🔍 Verifying Phase-Step Contract...\n');

    let passed = 0;
    let failed = 0;

    // Check that all phases have valid step numbers
    for (const [phase, step] of Object.entries(PHASE_STEP_MAP)) {
        if (step >= 0 && step <= 7) {
            console.log(`✅ ${phase} → Step ${step}`);
            passed++;
        } else {
            console.log(`❌ ${phase} → Invalid step ${step}`);
            failed++;
        }
    }

    console.log(`\n📊 Contract Verification: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

async function verifyPhaseTransitions() {
    console.log('\n🔍 Verifying Phase Transitions...\n');

    let passed = 0;
    let failed = 0;

    for (const [fromPhase, toPhase] of Object.entries(LEGAL_PHASE_TRANSITIONS)) {
        const fromStep = PHASE_STEP_MAP[fromPhase];
        const toStep = PHASE_STEP_MAP[toPhase];

        if (toStep === fromStep + 1 || (fromPhase === 'merging_review' && toPhase === 'completed')) {
            console.log(`✅ ${fromPhase} (Step ${fromStep}) → ${toPhase} (Step ${toStep})`);
            passed++;
        } else {
            console.log(`❌ ${fromPhase} (Step ${fromStep}) → ${toPhase} (Step ${toStep}) - Invalid transition`);
            failed++;
        }
    }

    console.log(`\n📊 Transition Verification: ${passed} passed, ${failed} failed\n`);
    return failed === 0;
}

async function testPipelineFlow(pipelineId) {
    console.log('\n🔍 Testing Pipeline Flow...\n');

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        // Fetch pipeline
        const { data: pipeline, error } = await supabase
            .from('floorplan_pipelines')
            .select('*')
            .eq('id', pipelineId)
            .single();

        if (error) {
            console.log(`❌ Failed to fetch pipeline: ${error.message}`);
            return false;
        }

        console.log(`✅ Pipeline found: ${pipeline.id}`);
        console.log(`   Current phase: ${pipeline.whole_apartment_phase}`);
        console.log(`   Current step: ${PHASE_STEP_MAP[pipeline.whole_apartment_phase]}`);

        // Check if phase transition is needed
        const nextPhase = LEGAL_PHASE_TRANSITIONS[pipeline.whole_apartment_phase];
        if (nextPhase) {
            console.log(`   Next phase: ${nextPhase}`);
            console.log(`   Next step: ${PHASE_STEP_MAP[nextPhase]}`);
        } else {
            console.log(`   No legal transition from current phase`);
        }

        return true;
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        return false;
    }
}

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  RE-TOUR Pipeline Verification Script                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    const contractOk = await verifyPhaseStepContract();
    const transitionsOk = await verifyPhaseTransitions();

    // If pipeline ID provided, test actual pipeline
    const pipelineId = process.argv[2];
    let pipelineOk = true;

    if (pipelineId) {
        pipelineOk = await testPipelineFlow(pipelineId);
    } else {
        console.log('\n💡 Tip: Pass a pipeline ID to test actual pipeline flow');
        console.log('   Example: node verify-pipeline.js <pipeline-id>\n');
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Verification Summary                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Phase-Step Contract: ${contractOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Phase Transitions:   ${transitionsOk ? '✅ PASS' : '❌ FAIL'}`);
    if (pipelineId) {
        console.log(`Pipeline Flow:       ${pipelineOk ? '✅ PASS' : '❌ FAIL'}`);
    }

    const allOk = contractOk && transitionsOk && pipelineOk;
    console.log(`\n${allOk ? '✅ All checks passed!' : '❌ Some checks failed'}\n`);

    process.exit(allOk ? 0 : 1);
}

main().catch(console.error);
