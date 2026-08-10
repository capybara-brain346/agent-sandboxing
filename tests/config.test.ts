import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("configuration", () => {
  it("loads safe defaults with a required database URL", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://test" });
    expect(config.SANDBOX_IMAGE).toBe("node:22-bookworm");
    expect(config.COMMAND_OUTPUT_MAX_BYTES).toBeGreaterThan(0);
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
