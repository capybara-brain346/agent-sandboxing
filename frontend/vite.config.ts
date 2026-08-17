import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxies task API calls to the backend in dev so the SPA can call
    // same-origin paths without the backend needing CORS. See
    // docs/modules/frontend/README.md for the production CORS follow-up.
    proxy: {
      "/tasks": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
