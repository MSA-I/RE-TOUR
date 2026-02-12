-- Add missing camera_intent enum values to whole_apartment_phase
-- This fixes: "violates check constraint valid_whole_apartment_phase"

-- Add camera_intent_pending
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'camera_intent_pending'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'camera_intent_pending';
        RAISE NOTICE 'Added camera_intent_pending to enum';
    ELSE
        RAISE NOTICE 'camera_intent_pending already exists';
    END IF;
END $$;

-- Add camera_intent_confirmed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'camera_intent_confirmed'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'camera_intent_confirmed';
        RAISE NOTICE 'Added camera_intent_confirmed to enum';
    ELSE
        RAISE NOTICE 'camera_intent_confirmed already exists';
    END IF;
END $$;

-- Add prompt_templates_pending
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'prompt_templates_pending'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'prompt_templates_pending';
        RAISE NOTICE 'Added prompt_templates_pending to enum';
    ELSE
        RAISE NOTICE 'prompt_templates_pending already exists';
    END IF;
END $$;

-- Add prompt_templates_confirmed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'prompt_templates_confirmed'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'prompt_templates_confirmed';
        RAISE NOTICE 'Added prompt_templates_confirmed to enum';
    ELSE
        RAISE NOTICE 'prompt_templates_confirmed already exists';
    END IF;
END $$;

-- Add outputs_pending
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'outputs_pending'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'outputs_pending';
        RAISE NOTICE 'Added outputs_pending to enum';
    ELSE
        RAISE NOTICE 'outputs_pending already exists';
    END IF;
END $$;

-- Add outputs_in_progress
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'outputs_in_progress'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'outputs_in_progress';
        RAISE NOTICE 'Added outputs_in_progress to enum';
    ELSE
        RAISE NOTICE 'outputs_in_progress already exists';
    END IF;
END $$;

-- Add outputs_review
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'whole_apartment_phase'
        AND e.enumlabel = 'outputs_review'
    ) THEN
        ALTER TYPE whole_apartment_phase ADD VALUE 'outputs_review';
        RAISE NOTICE 'Added outputs_review to enum';
    ELSE
        RAISE NOTICE 'outputs_review already exists';
    END IF;
END $$;

-- Verify all values were added
SELECT
    e.enumlabel AS phase_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'whole_apartment_phase'
AND e.enumlabel LIKE '%camera_intent%'
   OR e.enumlabel LIKE '%prompt_templates%'
   OR e.enumlabel LIKE '%outputs_%'
ORDER BY e.enumsortorder;
