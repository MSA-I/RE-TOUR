/**
 * E2E Test Helper Functions
 *
 * Utilities for creating projects, uploading images, waiting for jobs, etc.
 */

import { supabaseTest } from './test-client';
import { loadTestImage } from './test-images';
import type { Tables } from '@/integrations/supabase/types';

type Upload = Tables<'uploads'>;
type Project = Tables<'projects'>;
type ImageEditJob = Tables<'image_edit_jobs'>;

/**
 * Sleep utility for polling
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a test project
 *
 * @param name - Project name
 * @param userId - Owner user ID
 * @returns Created project
 */
export async function createTestProject(
  name: string,
  userId: string
): Promise<Project> {
  const { data, error } = await supabaseTest
    .from('projects')
    .insert({
      owner_id: userId,
      name,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test project: ${error.message}`);
  }

  return data;
}

/**
 * Upload a test image from the test images directory
 *
 * @param projectId - Project ID
 * @param userId - Owner user ID
 * @param filename - Name of file in test images directory
 * @param kind - Type of upload
 * @returns Created upload record
 */
export async function uploadTestImage(
  projectId: string,
  userId: string,
  filename: string,
  kind: 'panorama' | 'design_ref' | 'floor_plan'
): Promise<Upload> {
  // Load test image
  const file = await loadTestImage(filename);

  // Determine bucket
  const bucket = kind === 'panorama'
    ? 'panoramas'
    : kind === 'design_ref'
    ? 'design_refs'
    : 'floor_plans';

  // Generate path
  const path = `${userId}/${projectId}/${crypto.randomUUID()}-${filename.replace(/[^\w\.-]/g, '_')}`;

  // Get signed upload URL
  const { data: { session } } = await supabaseTest.auth.getSession();
  const { data: urlData, error: urlError } = await supabaseTest.functions.invoke(
    'create-signed-upload-url',
    {
      body: { bucket, path, contentType: file.type },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    }
  );

  if (urlError || !urlData) {
    throw new Error(`Failed to get signed upload URL: ${urlError?.message || 'No URL returned'}`);
  }

  // Upload file
  const uploadResponse = await fetch(urlData.signedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
      'Cache-Control': '3600',
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  // Create upload record
  const { data: upload, error: uploadError } = await supabaseTest
    .from('uploads')
    .insert({
      project_id: projectId,
      owner_id: userId,
      kind,
      bucket,
      path,
      original_filename: filename,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (uploadError) {
    throw new Error(`Failed to create upload record: ${uploadError.message}`);
  }

  return upload;
}

/**
 * Wait for a job to complete (or fail)
 *
 * @param jobId - Job ID to monitor
 * @param timeout - Max time to wait in milliseconds
 * @param pollInterval - How often to check status (ms)
 * @returns Completed job
 */
export async function waitForJobCompletion(
  jobId: string,
  timeout: number = 120000,
  pollInterval: number = 2000
): Promise<ImageEditJob> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { data: job, error } = await supabaseTest
      .from('image_edit_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch job status: ${error.message}`);
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }

    await sleep(pollInterval);
  }

  throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
}

/**
 * Assert no PostgREST error (specifically no 400 Bad Request)
 *
 * @param error - Supabase error object
 * @param context - Context message for better error reporting
 */
export function assertNoPostgrestError(error: any, context?: string): void {
  if (error) {
    const message = context
      ? `${context}: ${error.message || JSON.stringify(error)}`
      : error.message || JSON.stringify(error);

    // Check if it's a 400 error (the specific error we're fixing)
    if (error.code === '400' || error.message?.includes('400')) {
      throw new Error(`❌ 400 Bad Request error detected (THIS IS THE BUG): ${message}`);
    }

    throw new Error(`Query error: ${message}`);
  }
}

/**
 * Cleanup test project and all associated data
 *
 * @param projectId - Project ID to clean up
 */
export async function cleanupTestProject(projectId: string): Promise<void> {
  // Soft delete all uploads (tests the soft delete functionality too!)
  await supabaseTest
    .from('uploads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('project_id', projectId);

  // Delete project (cascades to other tables)
  await supabaseTest
    .from('projects')
    .delete()
    .eq('id', projectId);
}

/**
 * Create and start an image edit job
 *
 * @param params - Job parameters
 * @returns Created job
 */
export async function createImageEditJob(params: {
  projectId: string;
  userId: string;
  sourceUploadId: string;
  referenceUploadIds?: string[];
  changeDescription: string;
  aspectRatio?: string;
  outputQuality?: string;
}): Promise<ImageEditJob> {
  const { data: job, error } = await supabaseTest
    .from('image_edit_jobs')
    .insert({
      project_id: params.projectId,
      owner_id: params.userId,
      source_upload_id: params.sourceUploadId,
      reference_upload_ids: params.referenceUploadIds || [],
      change_description: params.changeDescription,
      aspect_ratio: params.aspectRatio || '16:9',
      output_quality: params.outputQuality || 'standard',
      status: 'queued',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create image edit job: ${error.message}`);
  }

  // Start the job
  const { data: { session } } = await supabaseTest.auth.getSession();
  const { error: startError } = await supabaseTest.functions.invoke(
    'start-image-edit-job',
    {
      body: { job_id: job.id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    }
  );

  if (startError) {
    throw new Error(`Failed to start job: ${startError.message}`);
  }

  return job;
}
