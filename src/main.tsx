import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/base.css";
import "./styles.css";
import App from "./App";
import { initAudio, registerModules } from "./audio/engine";
import { MODULES } from "./modules";

const root = createRoot(document.getElementById("root")!);

registerModules(MODULES);
initAudio().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (err) => {
    console.error(err);
    root.render(
      <div className="fatal">
        This browser couldn't start the audio engine (AudioWorklet). Try a recent Chrome, Firefox or Safari.
      </div>,
    );
  },
);
