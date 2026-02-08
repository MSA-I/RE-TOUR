import { createRoot, Root } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { FatalErrorFallback } from "@/components/FatalErrorFallback";

let root: Root | null = null;

function renderFatal(message?: string) {
  const el = document.getElementById("root");
  if (!el) return;

  try {
    if (!root) root = createRoot(el);
    root.render(
      <FatalErrorFallback
        message={message ?? "A fatal error occurred during startup."}
      />
    );
  } catch {
    // Absolute last resort if React can't mount
    el.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui;">
        <div style="max-width:520px;width:100%;text-align:center;">
          <h1 style="font-size:20px;margin:0 0 8px;">Something went wrong</h1>
          <p style="opacity:.8;margin:0 0 16px;">Please reload the page.</p>
          <button style="padding:10px 14px;" onclick="location.reload()">Reload</button>
        </div>
      </div>
    `;
  }
}

function mount() {
  const el = document.getElementById("root");
  if (!el) return;

  root = createRoot(el);
  root.render(<App />);
}

// If anything blows up before/while React renders, show a non-blank fallback.
window.addEventListener("error", (e) => {
  // eslint-disable-next-line no-console
  console.error("[fatal] window.error", e.error || e.message);
  renderFatal(e.error?.message || e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  // eslint-disable-next-line no-console
  console.error("[fatal] unhandledrejection", e.reason);
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
  renderFatal(msg);
});

try {
  mount();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[fatal] mount failed", e);
  renderFatal(e instanceof Error ? e.message : String(e));
}

