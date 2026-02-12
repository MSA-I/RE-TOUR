-- Check enum values exist
SELECT unnest(enum_range(NULL::whole_apartment_phase))::text AS phase_values
WHERE unnest(enum_range(NULL::whole_apartment_phase))::text IN ('camera_intent_pending', 'prompt_templates_pending', 'outputs_pending')
LIMIT 3;

-- Check trigger exists
SELECT tgname FROM pg_trigger WHERE tgname = 'enforce_phase_step_consistency';

-- Check view exists
SELECT COUNT(*) as view_exists FROM information_schema.views WHERE table_name = 'camera_intents_with_spaces';
