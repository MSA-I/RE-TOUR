/**
 * URL transformation utilities for local development
 *
 * Problem: In local Supabase (Docker), edge functions use SUPABASE_URL=http://kong:8000
 * (Docker's internal hostname). Storage signed URLs inherit this hostname, but browsers
 * cannot resolve "kong" → ERR_NAME_NOT_RESOLVED on upload/view/download.
 *
 * Solution: Transform kong:8000 → 127.0.0.1:54321 for URLs returned to browsers.
 * This is environment-aware and production-safe (no transformation for .supabase.co URLs).
 */

/**
 * Detect if running in local development environment
 * @param supabaseUrl - The SUPABASE_URL from environment
 * @returns true if local dev (contains kong:8000 or localhost or 127.0.0.1)
 */
export function isLocalDevelopment(supabaseUrl: string): boolean {
  return (
    supabaseUrl.includes('kong:8000') ||
    supabaseUrl.includes('localhost') ||
    supabaseUrl.includes('127.0.0.1')
  );
}

/**
 * Transform storage URLs from Docker-internal hostname to browser-accessible localhost
 * @param signedUrl - The signed URL returned by Supabase Storage API
 * @param supabaseUrl - The SUPABASE_URL from environment (for environment detection)
 * @returns Transformed URL (if local dev) or original URL (if production)
 */
export function transformStorageUrl(signedUrl: string, supabaseUrl: string): string {
  // Skip transformation in production (URLs with .supabase.co domain)
  if (supabaseUrl.includes('.supabase.co')) {
    console.log('[url-transform] Production environment detected - no transformation needed');
    return signedUrl;
  }

  // Skip if URL is already localhost-accessible
  if (signedUrl.includes('127.0.0.1') || signedUrl.includes('localhost')) {
    console.log('[url-transform] URL already uses localhost - no transformation needed');
    return signedUrl;
  }

  // Transform kong:8000 → 127.0.0.1:54321 for local dev
  if (signedUrl.includes('kong:8000')) {
    const transformedUrl = signedUrl.replace(/http:\/\/kong:8000/g, 'http://127.0.0.1:54321');
    console.log('[url-transform] Transformed URL for local dev:', {
      from: 'kong:8000',
      to: '127.0.0.1:54321',
      originalPrefix: signedUrl.substring(0, 30),
      transformedPrefix: transformedUrl.substring(0, 30)
    });
    return transformedUrl;
  }

  // No transformation needed
  console.log('[url-transform] No transformation needed for URL:', signedUrl.substring(0, 50));
  return signedUrl;
}
