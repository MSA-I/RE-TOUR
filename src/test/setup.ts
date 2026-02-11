/**
 * Vitest Setup File
 *
 * Global test configuration and utilities for the RE-TOUR test suite.
 * Authority: deep_debugger_plan.md
 */

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock matchMedia (for components using prefers-reduced-motion)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Extend expect with custom matchers if needed
expect.extend({
  toBeValidPhaseTransition(received: { from: string; to: string }, expected: boolean) {
    const pass = expected === true;
    return {
      pass,
      message: () =>
        pass
          ? `Expected transition from ${received.from} to ${received.to} to be invalid`
          : `Expected transition from ${received.from} to ${received.to} to be valid`,
    };
  },
});
