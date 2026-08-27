import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/chat-sessions": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/github": "http://localhost:3000",
    },
  },
});
