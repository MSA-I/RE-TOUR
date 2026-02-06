-- Add new columns to floorplan_space_renders for inpaint/edit flow
ALTER TABLE floorplan_space_renders
ADD COLUMN IF NOT EXISTS job_type text DEFAULT 'generate',
ADD COLUMN IF NOT EXISTS source_image_upload_id uuid REFERENCES uploads(id),
ADD COLUMN IF NOT EXISTS user_correction_text text,
ADD COLUMN IF NOT EXISTS correction_mode text DEFAULT 'inpaint',
ADD COLUMN IF NOT EXISTS pre_rejection_qa_status text;

-- Add check constraint for job_type on renders
ALTER TABLE floorplan_space_renders
ADD CONSTRAINT floorplan_space_renders_valid_job_type CHECK (job_type IN ('generate', 'edit_inpaint'));

-- Same columns for panoramas
ALTER TABLE floorplan_space_panoramas
ADD COLUMN IF NOT EXISTS job_type text DEFAULT 'generate',
ADD COLUMN IF NOT EXISTS source_image_upload_id uuid REFERENCES uploads(id),
ADD COLUMN IF NOT EXISTS user_correction_text text,
ADD COLUMN IF NOT EXISTS correction_mode text DEFAULT 'inpaint',
ADD COLUMN IF NOT EXISTS pre_rejection_qa_status text;

-- Add check constraint for job_type on panoramas
ALTER TABLE floorplan_space_panoramas
ADD CONSTRAINT floorplan_space_panoramas_valid_job_type CHECK (job_type IN ('generate', 'edit_inpaint'));

-- Same columns for final360
ALTER TABLE floorplan_space_final360
ADD COLUMN IF NOT EXISTS job_type text DEFAULT 'generate',
ADD COLUMN IF NOT EXISTS source_image_upload_id uuid REFERENCES uploads(id),
ADD COLUMN IF NOT EXISTS user_correction_text text,
ADD COLUMN IF NOT EXISTS correction_mode text DEFAULT 'inpaint',
ADD COLUMN IF NOT EXISTS pre_rejection_qa_status text;

-- Add check constraint for job_type on final360
ALTER TABLE floorplan_space_final360
ADD CONSTRAINT floorplan_space_final360_valid_job_type CHECK (job_type IN ('generate', 'edit_inpaint'));