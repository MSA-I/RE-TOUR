/**
 * Upload and Soft Delete Tests
 *
 * Tests the core upload functionality and soft delete behavior
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { supabaseTest, signInTestUser, signOutTestUser } from '../setup/test-client';
import {
  createTestProject,
  uploadTestImage,
  cleanupTestProject,
  assertNoPostgrestError,
} from '../setup/test-helpers';
import { TEST_IMAGES } from '../setup/test-images';

describe('Upload and Soft Delete', () => {
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const { userId: uid } = await signInTestUser();
    userId = uid;

    const project = await createTestProject('Upload Test Project', userId);
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await cleanupTestProject(projectId);
    }
    await signOutTestUser();
  });

  test('should upload image from Hebrew path without errors', async () => {
    // Test uploading an image with Hebrew filename
    const upload = await uploadTestImage(
      projectId,
      userId,
      'תמונה מושלמת.jpg',
      'design_ref'
    );

    expect(upload.id).toBeDefined();
    expect(upload.project_id).toBe(projectId);
    expect(upload.owner_id).toBe(userId);
    expect(upload.kind).toBe('design_ref');
    expect(upload.deleted_at).toBeNull();
    expect(upload.deleted_by).toBeNull();
    expect(upload.original_filename).toBe('תמונה מושלמת.jpg');
  });

  test('should upload multiple image types', async () => {
    // Test panorama
    const panorama = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.panoramas[0],
      'panorama'
    );
    expect(panorama.kind).toBe('panorama');
    expect(panorama.bucket).toBe('panoramas');

    // Test floor plan
    const floorPlan = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.floorPlans[0],
      'floor_plan'
    );
    expect(floorPlan.kind).toBe('floor_plan');
    expect(floorPlan.bucket).toBe('floor_plans');

    // Test design ref
    const designRef = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.designRefs[0],
      'design_ref'
    );
    expect(designRef.kind).toBe('design_ref');
    expect(designRef.bucket).toBe('design_refs');
  });

  test('should soft delete upload and filter correctly', async () => {
    // Upload image
    const upload = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.designRefs[1],
      'design_ref'
    );

    // Soft delete it
    const { error: deleteError } = await supabaseTest
      .from('uploads')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
      })
      .eq('id', upload.id);

    assertNoPostgrestError(deleteError, 'Soft delete upload');

    // Query for non-deleted uploads (should NOT include our upload)
    const { data, error } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    assertNoPostgrestError(error, 'Query after soft delete');
    expect(data).toBeDefined();

    // Our soft-deleted upload should NOT be in the results
    const foundUpload = data?.find((u) => u.id === upload.id);
    expect(foundUpload).toBeUndefined();

    // Query for deleted uploads (should include our upload)
    const { data: deletedData, error: deletedError } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .not('deleted_at', 'is', null);

    assertNoPostgrestError(deletedError, 'Query deleted uploads');
    expect(deletedData).toBeDefined();

    const deletedUpload = deletedData?.find((u) => u.id === upload.id);
    expect(deletedUpload).toBeDefined();
    expect(deletedUpload?.deleted_at).not.toBeNull();
    expect(deletedUpload?.deleted_by).toBe(userId);
  });

  test('should restore soft-deleted upload', async () => {
    // Upload and soft delete
    const upload = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.designRefs[2],
      'design_ref'
    );

    await supabaseTest
      .from('uploads')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', upload.id);

    // Restore (set deleted_at back to null)
    const { error: restoreError } = await supabaseTest
      .from('uploads')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', upload.id);

    assertNoPostgrestError(restoreError, 'Restore soft-deleted upload');

    // Query for active uploads (should include our restored upload)
    const { data, error } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    assertNoPostgrestError(error, 'Query after restore');
    expect(data).toBeDefined();

    const restoredUpload = data?.find((u) => u.id === upload.id);
    expect(restoredUpload).toBeDefined();
    expect(restoredUpload?.deleted_at).toBeNull();
    expect(restoredUpload?.deleted_by).toBeNull();
  });

  test('should handle multiple uploads and selective soft delete', async () => {
    // Upload 3 images
    const uploads = await Promise.all([
      uploadTestImage(projectId, userId, TEST_IMAGES.designRefs[0], 'design_ref'),
      uploadTestImage(projectId, userId, TEST_IMAGES.designRefs[1], 'design_ref'),
      uploadTestImage(projectId, userId, TEST_IMAGES.designRefs[2], 'design_ref'),
    ]);

    // Soft delete only the middle one
    await supabaseTest
      .from('uploads')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', uploads[1].id);

    // Query active uploads
    const { data, error } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    assertNoPostgrestError(error, 'Query selective soft delete');
    expect(data).toBeDefined();

    // Should have upload[0] and upload[2], but NOT upload[1]
    expect(data?.find((u) => u.id === uploads[0].id)).toBeDefined();
    expect(data?.find((u) => u.id === uploads[1].id)).toBeUndefined();
    expect(data?.find((u) => u.id === uploads[2].id)).toBeDefined();
  });

  test('should soft delete multiple uploads at once', async () => {
    // Upload 3 images
    const uploads = await Promise.all([
      uploadTestImage(projectId, userId, 'ComfyUI_01808_.png', 'design_ref'),
      uploadTestImage(projectId, userId, 'ComfyUI_01810_.png', 'design_ref'),
      uploadTestImage(projectId, userId, 'ComfyUI_01811_.png', 'design_ref'),
    ]);

    const uploadIds = uploads.map((u) => u.id);

    // Soft delete all at once (mimics softDeleteUpload mutation)
    const { error: batchDeleteError } = await supabaseTest
      .from('uploads')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
      })
      .in('id', uploadIds);

    assertNoPostgrestError(batchDeleteError, 'Batch soft delete');

    // Verify none are in active uploads
    const { data, error } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    assertNoPostgrestError(error, 'Query after batch delete');
    expect(data).toBeDefined();

    for (const id of uploadIds) {
      expect(data?.find((u) => u.id === id)).toBeUndefined();
    }
  });
});
