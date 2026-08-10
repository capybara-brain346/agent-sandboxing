import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/runtime/**/*.test.ts"], pool: "forks", fileParallelism: false } });
