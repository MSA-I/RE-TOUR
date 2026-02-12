/**
 * Accessibility Utilities
 *
 * Helper functions and constants for WCAG 2.1 AA compliance
 */

/**
 * Focus management utilities
 */
export const focusUtils = {
  /**
   * Trap focus within an element (for modals, dialogs)
   */
  trapFocus: (element: HTMLElement) => {
    const focusableElements = element.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    element.addEventListener("keydown", handleTab);

    return () => {
      element.removeEventListener("keydown", handleTab);
    };
  },

  /**
   * Move focus to an element and announce to screen readers
   */
  moveFocusTo: (element: HTMLElement | null, announce?: string) => {
    if (!element) return;
    element.focus();
    if (announce) {
      announceToScreenReader(announce);
    }
  },
};

/**
 * Announce message to screen readers without visual display
 */
export function announceToScreenReader(message: string, priority: "polite" | "assertive" = "polite") {
  const announcement = document.createElement("div");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", priority);
  announcement.setAttribute("aria-atomic", "true");
  announcement.className = "sr-only"; // Visually hidden but accessible
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * WCAG 2.1 AA minimum touch target size
 */
export const MIN_TOUCH_TARGET_SIZE = 44; // pixels

/**
 * WCAG 2.1 AA minimum color contrast ratios
 */
export const MIN_CONTRAST = {
  NORMAL_TEXT: 4.5,
  LARGE_TEXT: 3.0, // 18px+ or 14px+ bold
  UI_COMPONENTS: 3.0,
};

/**
 * Keyboard event handlers
 */
export const keyboardHandlers = {
  /**
   * Handle Enter/Space as click for buttons
   */
  handleActivation: (callback: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback();
    }
  },

  /**
   * Handle Escape key
   */
  handleEscape: (callback: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      callback();
    }
  },

  /**
   * Handle arrow navigation in lists
   */
  handleArrowNavigation: (
    items: HTMLElement[],
    currentIndex: number,
    onNavigate: (newIndex: number) => void
  ) => (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        onNavigate(Math.min(currentIndex + 1, items.length - 1));
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        onNavigate(Math.max(currentIndex - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        onNavigate(0);
        break;
      case "End":
        e.preventDefault();
        onNavigate(items.length - 1);
        break;
    }
  },
};

/**
 * Generate accessible button props
 */
export function getAccessibleButtonProps(config: {
  label: string;
  description?: string;
  disabled?: boolean;
  pressed?: boolean;
  loading?: boolean;
}) {
  return {
    "aria-label": config.label,
    "aria-describedby": config.description ? `${config.label}-description` : undefined,
    "aria-disabled": config.disabled,
    "aria-pressed": config.pressed,
    "aria-busy": config.loading,
  };
}

/**
 * Generate accessible form field props
 */
export function getAccessibleFormFieldProps(config: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  description?: string;
}) {
  return {
    id: config.id,
    "aria-labelledby": `${config.id}-label`,
    "aria-describedby": config.description ? `${config.id}-description` : undefined,
    "aria-invalid": !!config.error,
    "aria-errormessage": config.error ? `${config.id}-error` : undefined,
    "aria-required": config.required,
  };
}

/**
 * CSS class for screen-reader-only content
 */
export const SR_ONLY_CLASS = "sr-only";

/**
 * Ensure minimum touch target size
 */
export function ensureMinTouchTarget(size: number): string {
  return `min-w-[${Math.max(size, MIN_TOUCH_TARGET_SIZE)}px] min-h-[${Math.max(size, MIN_TOUCH_TARGET_SIZE)}px]`;
}
