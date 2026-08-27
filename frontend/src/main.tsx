import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/theme.css";
import App from "./App.tsx";
import { applyTheme, getInitialTheme } from "./hooks/useTheme";

applyTheme(getInitialTheme());

if (import.meta.env.DEV) {
  const [React, ReactDOM, { default: axe }] = await Promise.all([
    import("react"),
    import("react-dom"),
    import("@axe-core/react"),
  ]);
  void axe(React, ReactDOM, 1000);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
