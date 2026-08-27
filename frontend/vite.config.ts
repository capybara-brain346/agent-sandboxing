import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/chat-sessions": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/github": "http://localhost:3000",
    },
  },
});
