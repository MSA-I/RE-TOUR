/**
 * Performance utilities for debugging and optimization
 * Enable with ?debugPerf=1 in URL
 */

const isDebugPerf = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debugPerf') === '1';
};

// Render count tracking
const renderCounts = new Map<string, number>();

export function trackRender(componentName: string): void {
  if (!isDebugPerf()) return;
  
  const count = (renderCounts.get(componentName) || 0) + 1;
  renderCounts.set(componentName, count);
  
  if (count % 10 === 0) {
    console.warn(`[PERF] ${componentName} rendered ${count} times`);
  }
}

// Long task observer
let longTaskObserver: PerformanceObserver | null = null;

export function initLongTaskObserver(): () => void {
  if (!isDebugPerf() || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }
  
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          console.warn(`[PERF] Long task detected: ${entry.duration.toFixed(1)}ms`, entry);
        }
      }
    });
    
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    // longtask not supported
  }
  
  return () => {
    longTaskObserver?.disconnect();
  };
}

// Memory tracking
let memoryInterval: number | null = null;

export function initMemoryTracking(): () => void {
  if (!isDebugPerf()) return () => {};
  
  const perf = performance as any;
  if (!perf.memory) return () => {};
  
  let lastHeap = 0;
  
  memoryInterval = window.setInterval(() => {
    const heap = perf.memory.usedJSHeapSize;
    const heapMB = (heap / 1024 / 1024).toFixed(1);
    const delta = ((heap - lastHeap) / 1024 / 1024).toFixed(2);
    
    if (Math.abs(heap - lastHeap) > 5 * 1024 * 1024) {
      console.warn(`[PERF] Memory: ${heapMB}MB (Δ${delta}MB)`);
    }
    
    lastHeap = heap;
  }, 10000);
  
  return () => {
    if (memoryInterval) clearInterval(memoryInterval);
  };
}

// Debounce utility
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// Stable reference for empty arrays/objects
export const EMPTY_ARRAY: readonly never[] = Object.freeze([]) as readonly never[];
export const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({}) as Readonly<Record<string, never>>;
