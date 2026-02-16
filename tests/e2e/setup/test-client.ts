/**
 * Supabase Test Client
 *
 * Configured for local E2E testing against http://127.0.0.1:54321
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

// Local Supabase instance for E2E tests
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Test Supabase client instance
 * Uses local development instance at 127.0.0.1:54321
 */
export const supabaseTest = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false, // Don't persist sessions in tests
    autoRefreshToken: false,
  },
});

/**
 * Test user credentials for authentication
 * These should match your test user in the local database
 */
export const TEST_USER = {
  email: 'test@example.com',
  password: 'test123456',
};

/**
 * Sign in as test user
 * Creates user if it doesn't exist
 *
 * @returns User ID and session
 */
export async function signInTestUser() {
  // Try to sign in
  let { data: signInData, error: signInError } = await supabaseTest.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  // If user doesn't exist, create it
  if (signInError && signInError.message.includes('Invalid login')) {
    const { data: signUpData, error: signUpError } = await supabaseTest.auth.signUp({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    if (signUpError) {
      throw new Error(`Failed to create test user: ${signUpError.message}`);
    }

    signInData = signUpData;
  } else if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`);
  }

  if (!signInData.user || !signInData.session) {
    throw new Error('Sign in succeeded but no user or session returned');
  }

  return {
    userId: signInData.user.id,
    session: signInData.session,
  };
}

/**
 * Sign out test user
 */
export async function signOutTestUser() {
  await supabaseTest.auth.signOut();
}

/**
 * Clean up test user (optional, for complete teardown)
 */
export async function deleteTestUser() {
  // Note: This requires admin privileges
  // In practice, just leave test users in local DB
  await supabaseTest.auth.admin.deleteUser(
    (await supabaseTest.auth.getUser()).data.user?.id || ''
  );
}
