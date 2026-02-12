# Testing Setup Guide

**Authority:** deep_debugger_plan.md
**Date:** 2026-02-11
**Status:** REQUIRED for zero-tolerance breakage prevention

---

## Overview

This project requires comprehensive test coverage to prevent system breakage during pipeline migration. This document outlines the testing infrastructure setup.

---

## Step 1: Install Testing Dependencies

Run the following command to install all required testing libraries:

```bash
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/testing-library__jest-dom happy-dom
```

**Packages Installed:**
- `vitest` - Fast Vite-native test runner
- `@vitest/ui` - UI for test results visualization
- `@testing-library/react` - React component testing utilities
- `@testing-library/jest-dom` - Custom jest-dom matchers
- `@testing-library/user-event` - User interaction simulation
- `jsdom` or `happy-dom` - DOM implementation for Node
- `@types/testing-library__jest-dom` - TypeScript types

---

## Step 2: Create Vitest Configuration

**File:** `vitest.config.ts` (already created)

Configures Vitest with:
- React testing environment (jsdom/happy-dom)
- Path aliases (@/)
- Global test utilities
- Coverage configuration

---

## Step 3: Update package.json Scripts

Add the following scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

**Script Descriptions:**
- `test` - Run tests in watch mode
- `test:ui` - Open Vitest UI
- `test:run` - Run tests once (CI mode)
- `test:coverage` - Run tests with coverage report
- `test:integration` - Run integration tests only

---

## Step 4: Create Test Setup File

**File:** `src/test/setup.ts` (already created)

Configures:
- jest-dom matchers
- Global test utilities
- Mock implementations
- Test environment setup

---

## Step 5: Directory Structure

Create the following test directories:

```
A:/RE-TOUR/
├── src/
│   ├── hooks/
│   │   └── __tests__/
│   │       └── useWholeApartmentPipeline.phaseTransitions.comprehensive.test.ts
│   ├── components/
│   │   └── whole-apartment/
│   │       └── __tests__/
│   │           └── CameraIntentSelectorPanel.comprehensive.test.tsx
│   └── test/
│       └── setup.ts
├── tests/
│   └── integration/
│       └── pipeline_e2e.test.ts
├── supabase/
│   ├── functions/
│   │   └── save-camera-intents/
│   │       └── __tests__/
│   │           └── decision_only.test.ts
│   └── tests/
│       └── constraints/
│           └── all_constraints.test.sql
└── vitest.config.ts
```

---

## Step 6: Running Tests

### Unit Tests
```bash
npm run test
```

### Integration Tests
```bash
npm run test:integration
```

### Database Tests
```bash
supabase test db
```

### All Tests
```bash
npm run test:run && supabase test db
```

---

## Step 7: Test Coverage Requirements

**Hard Constraint:** 100% pass rate required before deployment

### Coverage Targets:
- **Phase Transitions:** 100% of legal transitions tested
- **Camera Intent Logic:** 100% of decision-only rules tested
- **Database Constraints:** 100% of constraints verified
- **UI Components:** Critical paths tested (Step 3, Step 4)
- **Integration:** Full E2E pipeline flow tested

---

## Step 8: Continuous Integration

Add to CI/CD pipeline (`.github/workflows/test.yml`):

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:run
      - run: npm run test:coverage

  database-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
      - run: supabase test db
```

---

## Checkpoint Gates

### Checkpoint 1: Backend Verification
**Command:** `npm run test -- hooks`
**Gate:** Must pass 100% before proceeding to database migrations

### Checkpoint 2: Database Verification
**Command:** `supabase test db`
**Gate:** Must pass 100% before proceeding to UI changes

### Checkpoint 3: UI Verification
**Command:** `npm run test -- components`
**Gate:** Must pass 100% before deploying

### Checkpoint 4: Integration Verification
**Command:** `npm run test:integration`
**Gate:** Must pass 100% before production deployment

---

## Rollback Procedures

If any checkpoint fails:

1. **DO NOT PROCEED** to next phase
2. **Investigate** root cause using systematic debugging
3. **Fix** the failing test
4. **Re-run** all tests from the beginning
5. **Only proceed** when 100% pass rate achieved

---

## Monitoring Post-Deployment

After deployment, monitor:

1. **Test execution time** - should remain under 5 minutes
2. **Flaky tests** - investigate any intermittent failures
3. **Coverage %** - should remain above 80% overall
4. **Integration test success** - should remain 100%

---

## Test File Status

### Created:
- ✅ `vitest.config.ts`
- ✅ `src/test/setup.ts`
- ✅ Unit tests (phase transitions)
- ✅ UI tests (CameraIntentSelectorPanel)
- ✅ Integration tests (E2E pipeline)
- ✅ Database constraint tests

### Pending Installation:
- ⏳ Vitest and testing libraries (run `npm install` command above)

---

## Next Steps

1. Run the `npm install` command to install dependencies
2. Run `npm run test` to verify setup
3. All tests should pass (or be created)
4. Proceed to checkpoints in order

---

## Support

If tests fail or setup issues occur:
1. Check this document for configuration
2. Review `vitest.config.ts` for path aliases
3. Ensure all dependencies installed correctly
4. Run `npm run test:ui` for visual debugging

---

**Zero Tolerance for Breakage**
All tests must pass before deployment.
