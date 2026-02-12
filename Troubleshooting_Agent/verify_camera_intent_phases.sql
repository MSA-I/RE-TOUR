-- Verify camera_intent phases exist in database

-- Check if enum type exists and what values it has
SELECT
    t.typname AS enum_type,
    e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
ORDER BY e.enumsortorder;

-- Check if camera_intent_pending and camera_intent_confirmed exist
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = 'whole_apartment_phase'
            AND e.enumlabel = 'camera_intent_pending'
        ) THEN 'EXISTS'
        ELSE 'MISSING'
    END AS camera_intent_pending_status,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = 'whole_apartment_phase'
            AND e.enumlabel = 'camera_intent_confirmed'
        ) THEN 'EXISTS'
        ELSE 'MISSING'
    END AS camera_intent_confirmed_status;
