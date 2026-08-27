import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Docker Compose configuration", () => {
  it("forwards Langfuse configuration to the app", async () => {
    const compose = parse(
      await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    ) as {
      services: {
        app: {
          environment: Record<string, unknown>;
        };
      };
    };

    expect(compose.services.app.environment).toMatchObject({
      LOG_LEVEL: "${LOG_LEVEL:-debug}",
      LOG_COLOR: "${LOG_COLOR:-auto}",
      LANGFUSE_ENABLED: "${LANGFUSE_ENABLED:-false}",
      LANGFUSE_PUBLIC_KEY: "${LANGFUSE_PUBLIC_KEY:-}",
      LANGFUSE_SECRET_KEY: "${LANGFUSE_SECRET_KEY:-}",
      LANGFUSE_BASE_URL: "${LANGFUSE_BASE_URL:-https://cloud.langfuse.com}",
      LANGFUSE_FLUSH_TIMEOUT_MS: "${LANGFUSE_FLUSH_TIMEOUT_MS:-2000}",
    });
  });
});
