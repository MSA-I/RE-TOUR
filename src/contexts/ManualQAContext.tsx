import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";

interface ManualQAContextValue {
  /** Whether manual QA approval is required after AI-QA passes */
  manualQAEnabled: boolean;
  /** Toggle manual QA mode */
  setManualQAEnabled: (enabled: boolean) => void;
  /** Check if an asset needs manual QA (AI-QA passed but not manually approved) */
  needsManualQA: (aiQAStatus: string | null) => boolean;
}

const ManualQAContext = createContext<ManualQAContextValue | null>(null);

const MANUAL_QA_STORAGE_KEY = "retour_manual_qa_enabled";

export function ManualQAProvider({ children }: { children: ReactNode }) {
  // Default to ON for safety until system is proven stable
  const [manualQAEnabled, setManualQAEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(MANUAL_QA_STORAGE_KEY);
      // Default to true (ON) if not set
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const setManualQAEnabled = useCallback((enabled: boolean) => {
    setManualQAEnabledState(enabled);
    try {
      localStorage.setItem(MANUAL_QA_STORAGE_KEY, String(enabled));
    } catch (e) {
      console.warn("Failed to persist manual QA setting:", e);
    }
  }, []);

  const needsManualQA = useCallback(
    (aiQAStatus: string | null): boolean => {
      if (!manualQAEnabled) return false;
      // AI-QA has passed or approved, but we still need manual approval
      return aiQAStatus === "passed" || aiQAStatus === "approved";
    },
    [manualQAEnabled]
  );

  return (
    <ManualQAContext.Provider
      value={{
        manualQAEnabled,
        setManualQAEnabled,
        needsManualQA,
      }}
    >
      {children}
    </ManualQAContext.Provider>
  );
}

export function useManualQA(): ManualQAContextValue {
  const context = useContext(ManualQAContext);
  if (!context) {
    throw new Error("useManualQA must be used within a ManualQAProvider");
  }
  return context;
}
