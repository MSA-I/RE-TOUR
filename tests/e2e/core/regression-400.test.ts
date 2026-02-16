/**
 * 400 Bad Request Regression Tests
 *
 * These tests verify that the exact 400 error reported by the user is fixed.
 * The error occurred because the frontend queries .is("deleted_at", null)
 * but the deleted_at column didn't exist in the database schema.
 *
 * Original error:
 * http://127.0.0.1:54321/rest/v1/uploads?select=*&project_id=eq.929f5776-88f4-47a1-8333-eea6e516af60&deleted_at=is.null
 * 400 (Bad Request)
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

describe('400 Bad Request Regression Tests', () => {
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    // Sign in as test user
    const { userId: uid } = await signInTestUser();
    userId = uid;

    // Create test project
    const project = await createTestProject('Regression Test Project', userId);
    projectId = project.id;
  });

  afterAll(async () => {
    // Cleanup
    if (projectId) {
      await cleanupTestProject(projectId);
    }
    await signOutTestUser();
  });

  test('should NOT return 400 when querying uploads with deleted_at filter', async () => {
    // This is the EXACT query pattern that was failing with 400 Bad Request
    const { data, error, status } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    // Assert no 400 error
    expect(status).not.toBe(400);

    // Assert no PostgREST error at all
    assertNoPostgrestError(error, 'Query with deleted_at filter');

    // Data should be defined (even if empty array)
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should handle useUploads hook query pattern', async () => {
    // Pattern from src/hooks/useUploads.ts:18-23
    const query = supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const { data, error, status } = await query;

    expect(status).not.toBe(400);
    assertNoPostgrestError(error, 'useUploads hook pattern');
    expect(data).toBeDefined();
  });

  test('should handle TestsTab query pattern with kind filter', async () => {
    // Pattern from src/components/tests/TestsTab.tsx
    const { data, error, status } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .eq('kind', 'design_ref')
      .is('deleted_at', null);

    expect(status).not.toBe(400);
    assertNoPostgrestError(error, 'TestsTab with kind filter');
    expect(data).toBeDefined();
  });

  test('should handle PipelineStepOutputs query pattern', async () => {
    // Pattern from src/components/PipelineStepOutputs.tsx
    const { data, error, status } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('kind', 'output')
      .is('deleted_at', null);

    expect(status).not.toBe(400);
    assertNoPostgrestError(error, 'PipelineStepOutputs pattern');
    expect(data).toBeDefined();
  });

  test('should query uploads with deleted_at filter after creating upload', async () => {
    // Upload a test image
    const upload = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.designRefs[0],
      'design_ref'
    );

    expect(upload.id).toBeDefined();
    expect(upload.deleted_at).toBeNull();

    // Query with deleted_at filter (should include our upload)
    const { data, error, status } = await supabaseTest
      .from('uploads')
      .select('*')
      .eq('project_id', projectId)
      .is('deleted_at', null);

    expect(status).not.toBe(400);
    assertNoPostgrestError(error, 'Query after upload');
    expect(data).toBeDefined();
    expect(data?.length).toBeGreaterThan(0);

    // Find our upload in the results
    const foundUpload = data?.find((u) => u.id === upload.id);
    expect(foundUpload).toBeDefined();
    expect(foundUpload?.deleted_at).toBeNull();
  });

  test('should handle multiple query patterns in sequence', async () => {
    // Test all affected query patterns from the codebase
    const queryPatterns = [
      // Pattern 1: Basic deleted_at filter
      () =>
        supabaseTest
          .from('uploads')
          .select('*')
          .is('deleted_at', null),

      // Pattern 2: With project filter
      () =>
        supabaseTest
          .from('uploads')
          .select('*')
          .eq('project_id', projectId)
          .is('deleted_at', null),

      // Pattern 3: With kind filter
      () =>
        supabaseTest
          .from('uploads')
          .select('*')
          .eq('kind', 'design_ref')
          .is('deleted_at', null),

      // Pattern 4: With ordering
      () =>
        supabaseTest
          .from('uploads')
          .select('*')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),

      // Pattern 5: With multiple filters
      () =>
        supabaseTest
          .from('uploads')
          .select('*')
          .eq('project_id', projectId)
          .eq('kind', 'panorama')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
    ];

    for (const [index, queryFn] of queryPatterns.entries()) {
      const { error, status } = await queryFn();

      expect(status).not.toBe(400);
      assertNoPostgrestError(error, `Query pattern ${index + 1}`);
    }
  });

  test('should verify deleted_at and deleted_by columns exist', async () => {
    // Upload a test image
    const upload = await uploadTestImage(
      projectId,
      userId,
      TEST_IMAGES.designRefs[1],
      'design_ref'
    );

    // Verify the columns exist by checking the returned data structure
    expect(upload).toHaveProperty('deleted_at');
    expect(upload).toHaveProperty('deleted_by');
    expect(upload.deleted_at).toBeNull();
    expect(upload.deleted_by).toBeNull();

    // Query to verify columns are selectable
    const { data, error } = await supabaseTest
      .from('uploads')
      .select('id, deleted_at, deleted_by')
      .eq('id', upload.id)
      .single();

    assertNoPostgrestError(error, 'Select deleted_at and deleted_by columns');
    expect(data).toBeDefined();
    expect(data?.deleted_at).toBeNull();
    expect(data?.deleted_by).toBeNull();
  });
});
