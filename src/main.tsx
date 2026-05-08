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
  import.meta.hot.on("vite:beforeUpdate", () => {
    // Remove stuck `inert` from every element (aria-hidden lib marks them with
    // `data-inert-ed` so we can find them precisely)
    document.querySelectorAll<HTMLElement>("[inert]").forEach((el) => {
      el.removeAttribute("inert");
      el.removeAttribute("data-inert-ed");
    });

    // Remove stuck `aria-hidden` markers (aria-hidden lib uses `data-aria-hidden`)
    document.querySelectorAll<HTMLElement>("[data-aria-hidden]").forEach((el) => {
      el.removeAttribute("aria-hidden");
      el.removeAttribute("data-aria-hidden");
    });

    // Reset body scroll-lock that Radix applies when a modal is open
    document.body.removeAttribute("data-scroll-locked");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");

    // Reset pointer-events on body in case any library applied it globally
    document.body.style.removeProperty("pointer-events");
  });
}

createRoot(document.getElementById("root")!).render(<App />);
