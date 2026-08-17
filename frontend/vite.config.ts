import type { IncomingMessage } from "node:http";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// `/tasks/:taskId` is both a backend API path and a client-side route
// (TaskDetailPage), so a plain proxy would forward direct navigations/
// reloads of that URL to the backend and show raw JSON instead of the SPA.
// Only bypass the proxy (and let Vite serve index.html) for real page
// navigations; fetch()/EventSource calls don't send `Accept: text/html`, so
// they still reach the backend.
const bypassNavigationRequests: ProxyOptions["bypass"] = (
  req: IncomingMessage,
) => {
  if (req.headers.accept?.includes("text/html")) {
    return "/index.html";
  }
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxies task API calls to the backend in dev so the SPA can call
    // same-origin paths without the backend needing CORS. See
    // docs/modules/frontend/README.md for the production CORS follow-up.
    proxy: {
      "/tasks": {
        target: "http://localhost:3000",
        bypass: bypassNavigationRequests,
      },
      "/health": "http://localhost:3000",
    },
  },
});
