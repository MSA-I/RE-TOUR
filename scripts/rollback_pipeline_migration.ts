import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function rollbackPipelineMigration() {
    console.log("[ROLLBACK] Starting pipeline rollback...");

    // 1. Revert phase names
    const phaseReverseMap = {
        "camera_intent_pending": "camera_plan_pending",
        "camera_intent_confirmed": "camera_plan_confirmed",
        "outputs_pending": "renders_pending",
        "outputs_in_progress": "renders_in_progress",
        "outputs_review": "renders_review",
    };

    for (const [newPhase, oldPhase] of Object.entries(phaseReverseMap)) {
        const { data, error } = await supabase
            .from("floorplan_pipelines")
            .update({ whole_apartment_phase: oldPhase })
            .eq("whole_apartment_phase", newPhase)
            .select("id");

        if (error) {
            console.error(`[ROLLBACK] Failed to rollback phase ${newPhase}:`, error);
        } else {
            console.log(`[ROLLBACK] Rolled back ${data.length} pipelines from ${newPhase} to ${oldPhase}`);
        }
    }

    // 2. Clean up new tables (optional - only if migration is fully reverted)
    console.warn("[ROLLBACK] To fully rollback, manually drop camera_intents and final_prompts tables");
    console.warn("[ROLLBACK] Run: DROP TABLE IF EXISTS camera_intents, final_prompts CASCADE;");

    console.log("[ROLLBACK] Rollback complete");
}

rollbackPipelineMigration().catch(console.error);
