import type { IncomingMessage } from "node:http";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const bypassNavigationRequests: ProxyOptions["bypass"] = (
  req: IncomingMessage,
) => {
  if (req.headers.accept?.includes("text/html")) {
    return "/index.html";
  }
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/chat-sessions": {
        target: "http://localhost:3000",
        bypass: bypassNavigationRequests,
      },
      "/health": "http://localhost:3000",
    },
  },
});
