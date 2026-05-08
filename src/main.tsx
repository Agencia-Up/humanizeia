import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── HMR Cleanup ───────────────────────────────────────────────────────────────
// Radix UI (Dialog, Sheet, Select, DropdownMenu, etc.) applies the `inert`
// attribute to all DOM elements OUTSIDE a modal when it opens, completely
// blocking pointer-events and keyboard input on those elements.
// When HMR fires, React may not run the modal's cleanup effect in time,
// leaving `inert` stuck on the app content → entire UI becomes non-interactive
// visually-correct but totally unresponsive. This hook cleans up before each update.
if (import.meta.hot) {
  // Helper — strips every stuck `inert` / `aria-hidden` the aria-hidden lib
  // (used by Radix UI) may have left behind after a modal was open during HMR.
  // Radix applies these to SIBLINGS of the portal inside #root, never to #root
  // itself, so we must querySelectorAll the whole document.
  function clearRadixLocks() {
    document.querySelectorAll<HTMLElement>("[inert]").forEach((el) => {
      el.removeAttribute("inert");
      el.removeAttribute("data-inert-ed");
    });
    document.querySelectorAll<HTMLElement>("[data-aria-hidden]").forEach((el) => {
      el.removeAttribute("aria-hidden");
      el.removeAttribute("data-aria-hidden");
    });
    document.body.removeAttribute("data-scroll-locked");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");
    document.body.style.removeProperty("pointer-events");
  }

  // Before the module swap — clears any pre-existing locks
  import.meta.hot.on("vite:beforeUpdate", clearRadixLocks);

  // After the module swap — Radix cleanup effects may fire during reconciliation
  // and re-apply `inert`; rAF lets React finish painting first, then we clean.
  import.meta.hot.on("vite:afterUpdate", () => {
    requestAnimationFrame(clearRadixLocks);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
