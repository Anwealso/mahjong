import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudio } from "./sound/player";
import "./styles.css";

// Browsers only allow sound after a click or key press.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, unlockAudio, { capture: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
