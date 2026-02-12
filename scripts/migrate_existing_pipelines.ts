import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function migrateExistingPipelines() {
    console.log("[MIGRATION] Starting pipeline migration...");

    // 1. Find pipelines in old phases
    const { data: pipelines, error } = await supabase
        .from("floorplan_pipelines")
        .select("id, whole_apartment_phase, current_step")
        .in("whole_apartment_phase", [
            "camera_plan_pending",
            "camera_plan_confirmed",
            "renders_pending",
            "renders_in_progress",
            "renders_review"
        ]);

    if (error) throw error;

    console.log(`[MIGRATION] Found ${pipelines.length} pipelines to migrate`);

    // 2. Migrate each pipeline
    for (const pipeline of pipelines) {
        let newPhase: string;

        switch (pipeline.whole_apartment_phase) {
            case "camera_plan_pending":
                newPhase = "camera_intent_pending";
                break;
            case "camera_plan_confirmed":
                newPhase = "camera_intent_confirmed";
                break;
            case "renders_pending":
                newPhase = "outputs_pending";
                break;
            case "renders_in_progress":
                newPhase = "outputs_in_progress";
                break;
            case "renders_review":
                newPhase = "outputs_review";
                break;
            default:
                console.warn(`[MIGRATION] Unknown phase: ${pipeline.whole_apartment_phase}`);
                continue;
        }

        // Update phase
        const { error: updateError } = await supabase
            .from("floorplan_pipelines")
            .update({ whole_apartment_phase: newPhase })
            .eq("id", pipeline.id);

        if (updateError) {
            console.error(`[MIGRATION] Failed to migrate pipeline ${pipeline.id}:`, updateError);
        } else {
            console.log(`[MIGRATION] Migrated pipeline ${pipeline.id}: ${pipeline.whole_apartment_phase} → ${newPhase}`);
        }
    }

    console.log("[MIGRATION] Pipeline migration complete");
}

migrateExistingPipelines().catch(console.error);
