import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      '**/__tests__/**/*.{test,spec}.{js,ts,jsx,tsx}',
      'tests/e2e/**/*.test.ts', // Include E2E tests
    ],
    exclude: ['node_modules', 'dist', '.next', 'supabase/functions'],
    testTimeout: 300000, // 5 minutes for long-running E2E workflows
    hookTimeout: 60000, // 1 minute for setup/teardown
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'src/test',
        'tests/e2e/setup', // Exclude test utilities from coverage
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        '**/types',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
