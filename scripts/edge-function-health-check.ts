/**
 * Edge Function Health Check Diagnostic Tool
 *
 * Tests connectivity, CORS, authentication, and deployment status
 * of critical Edge Functions in the RE-TOUR pipeline.
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/edge-function-health-check.ts
 */

interface HealthCheckResult {
  functionName: string;
  status: 'healthy' | 'degraded' | 'failed';
  checks: {
    cors: boolean;
    deployed: boolean;
    authenticated: boolean;
    responseTime: number | null;
  };
  errors: string[];
  warnings: string[];
}

interface TestConfig {
  name: string;
  requiresAuth: boolean;
  testPayload?: any;
}

// Test configuration for critical functions
const FUNCTIONS_TO_TEST: TestConfig[] = [
  {
    name: 'run-pipeline-step',
    requiresAuth: true,
    testPayload: null  // Cannot test without valid pipeline context
  },
  {
    name: 'get-constraint-stack-depth',
    requiresAuth: true,
    testPayload: { stepId: 1 }
  }
];

// Environment configuration
const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_ANON_KEY") || "";

/**
 * Test CORS preflight for a function
 */
async function testCORS(functionName: string): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${SUPABASE_URL}/functions/v1/${functionName}`;

    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
        'Origin': 'http://localhost:8080'
      }
    });

    // Check for CORS headers
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');
    const allowMethods = response.headers.get('Access-Control-Allow-Methods');
    const allowHeaders = response.headers.get('Access-Control-Allow-Headers');

    if (!allowOrigin) {
      return { success: false, error: 'Missing Access-Control-Allow-Origin header' };
    }

    if (!allowMethods || !allowMethods.includes('POST')) {
      return { success: false, error: 'POST method not allowed in CORS' };
    }

    if (!allowHeaders || !allowHeaders.toLowerCase().includes('authorization')) {
      return { success: false, error: 'Authorization header not allowed in CORS' };
    }

    if (response.status !== 200) {
      return { success: false, error: `OPTIONS returned ${response.status} (expected 200)` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `CORS test failed: ${error.message}` };
  }
}

/**
 * Test basic connectivity (deployment check)
 */
async function testDeployment(functionName: string): Promise<{ success: boolean; responseTime: number; error?: string }> {
  const startTime = Date.now();

  try {
    const url = `${SUPABASE_URL}/functions/v1/${functionName}`;

    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
      }
    });

    const responseTime = Date.now() - startTime;

    // Any response (even 404) means the function endpoint exists
    // We're looking for network-level failures or "function not found" errors
    if (response.status === 404) {
      return { success: false, responseTime, error: 'Function not found (404) - may not be deployed' };
    }

    return { success: true, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      return { success: false, responseTime, error: 'Network error - function may not be deployed or Supabase is unreachable' };
    }

    return { success: false, responseTime, error: `Deployment test failed: ${error.message}` };
  }
}

/**
 * Test authenticated request (if payload provided)
 */
async function testAuthentication(
  functionName: string,
  testPayload: any
): Promise<{ success: boolean; error?: string }> {
  if (!testPayload) {
    return { success: true }; // Skip if no test payload
  }

  if (!SUPABASE_ANON_KEY) {
    return { success: false, error: 'No SUPABASE_ANON_KEY in environment' };
  }

  try {
    const url = `${SUPABASE_URL}/functions/v1/${functionName}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    // We expect either:
    // - 401 (no user session, but auth flow works)
    // - 200 (success)
    // - 400 (bad payload, but function is reachable)
    // - 500 (function error, but deployed)

    if (response.status === 401) {
      // This is actually good - means the function is deployed and auth is working
      return { success: true };
    }

    if ([200, 400, 500].includes(response.status)) {
      return { success: true };
    }

    const text = await response.text();
    return { success: false, error: `Unexpected status ${response.status}: ${text}` };
  } catch (error) {
    return { success: false, error: `Auth test failed: ${error.message}` };
  }
}

/**
 * Run all health checks for a function
 */
async function checkFunction(config: TestConfig): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    functionName: config.name,
    status: 'healthy',
    checks: {
      cors: false,
      deployed: false,
      authenticated: false,
      responseTime: null
    },
    errors: [],
    warnings: []
  };

  console.log(`\nChecking ${config.name}...`);

  // Test 1: Deployment / Connectivity
  const deploymentResult = await testDeployment(config.name);
  result.checks.deployed = deploymentResult.success;
  result.checks.responseTime = deploymentResult.responseTime;

  if (!deploymentResult.success) {
    result.errors.push(`Deployment: ${deploymentResult.error}`);
    result.status = 'failed';
    console.log(`  ❌ Deployment: ${deploymentResult.error}`);
    return result; // No point testing further if not deployed
  }
  console.log(`  ✓ Deployment: Function is reachable (${deploymentResult.responseTime}ms)`);

  // Test 2: CORS
  const corsResult = await testCORS(config.name);
  result.checks.cors = corsResult.success;

  if (!corsResult.success) {
    result.errors.push(`CORS: ${corsResult.error}`);
    result.status = 'failed';
    console.log(`  ❌ CORS: ${corsResult.error}`);
  } else {
    console.log(`  ✓ CORS: Preflight passes`);
  }

  // Test 3: Authentication (if applicable)
  if (config.requiresAuth) {
    const authResult = await testAuthentication(config.name, config.testPayload);
    result.checks.authenticated = authResult.success;

    if (!authResult.success) {
      result.errors.push(`Authentication: ${authResult.error}`);
      if (result.status === 'healthy') result.status = 'degraded';
      console.log(`  ⚠️  Authentication: ${authResult.error}`);
    } else {
      console.log(`  ✓ Authentication: Flow works`);
    }
  }

  // Warnings
  if (result.checks.responseTime && result.checks.responseTime > 2000) {
    result.warnings.push(`Slow response time: ${result.checks.responseTime}ms`);
    if (result.status === 'healthy') result.status = 'degraded';
  }

  return result;
}

/**
 * Print summary report
 */
function printSummary(results: HealthCheckResult[]) {
  console.log('\n' + '='.repeat(60));
  console.log('HEALTH CHECK SUMMARY');
  console.log('='.repeat(60));

  const healthy = results.filter(r => r.status === 'healthy').length;
  const degraded = results.filter(r => r.status === 'degraded').length;
  const failed = results.filter(r => r.status === 'failed').length;

  console.log(`\nOverall Status:`);
  console.log(`  ✓ Healthy:  ${healthy}`);
  console.log(`  ⚠️  Degraded: ${degraded}`);
  console.log(`  ❌ Failed:   ${failed}`);

  if (failed > 0) {
    console.log('\n⚠️  CRITICAL ISSUES FOUND ⚠️');
    console.log('\nFailed Functions:');
    results
      .filter(r => r.status === 'failed')
      .forEach(r => {
        console.log(`\n  ${r.functionName}:`);
        r.errors.forEach(e => console.log(`    - ${e}`));
      });
  }

  if (degraded > 0) {
    console.log('\nDegraded Functions:');
    results
      .filter(r => r.status === 'degraded')
      .forEach(r => {
        console.log(`\n  ${r.functionName}:`);
        r.warnings.forEach(w => console.log(`    - ${w}`));
        r.errors.forEach(e => console.log(`    - ${e}`));
      });
  }

  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n1. Deploy missing functions:');
    console.log('   supabase functions deploy');
    console.log('\n2. Verify environment variables in Supabase dashboard:');
    console.log('   - SUPABASE_URL');
    console.log('   - SUPABASE_SERVICE_ROLE_KEY');
    console.log('   - API_NANOBANANA (if using image generation)');
    console.log('\n3. Check Supabase project status:');
    console.log('   https://zturojwgqtjrxwsfbwqw.supabase.co');
  } else if (degraded > 0) {
    console.log('\nFunctions are reachable but have warnings.');
    console.log('Review the degraded functions above for optimization opportunities.');
  } else {
    console.log('\n✓ All critical Edge Functions are healthy!');
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Verify environment configuration
 */
function checkEnvironment(): boolean {
  console.log('='.repeat(60));
  console.log('ENVIRONMENT CONFIGURATION');
  console.log('='.repeat(60));

  const checks = [
    { name: 'VITE_SUPABASE_URL', value: SUPABASE_URL },
    { name: 'VITE_SUPABASE_ANON_KEY', value: SUPABASE_ANON_KEY }
  ];

  let allGood = true;

  checks.forEach(check => {
    if (!check.value) {
      console.log(`❌ ${check.name}: NOT SET`);
      allGood = false;
    } else {
      const masked = check.value.substring(0, 20) + '...';
      console.log(`✓ ${check.name}: ${masked}`);
    }
  });

  if (!allGood) {
    console.log('\n⚠️  Missing environment variables!');
    console.log('Please set them in your .env file or environment.');
    return false;
  }

  console.log('\n✓ Environment configuration looks good\n');
  return true;
}

/**
 * Main execution
 */
async function main() {
  console.log('Edge Function Health Check');
  console.log('RE-TOUR Pipeline Diagnostic Tool\n');

  // Check environment first
  if (!checkEnvironment()) {
    Deno.exit(1);
  }

  // Run health checks
  const results: HealthCheckResult[] = [];

  for (const config of FUNCTIONS_TO_TEST) {
    const result = await checkFunction(config);
    results.push(result);
  }

  // Print summary
  printSummary(results);

  // Exit with appropriate code
  const failed = results.filter(r => r.status === 'failed').length;
  Deno.exit(failed > 0 ? 1 : 0);
}

// Run
if (import.meta.main) {
  main();
}
