import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { App } from "./app/App";
import { ThemeProvider } from "./app/theme";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
