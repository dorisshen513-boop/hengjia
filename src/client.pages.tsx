import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

const el = document.getElementById("app");
if (!el) {
  throw new Error("missing #app");
}

startTransition(() => {
  createRoot(el).render(
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
