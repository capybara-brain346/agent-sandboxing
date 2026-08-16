import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("configuration", () => {
  it("loads safe defaults with a required database URL", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://test" });
    expect(config.SANDBOX_IMAGE).toBe("node:22-bookworm");
    expect(config.COMMAND_OUTPUT_MAX_BYTES).toBeGreaterThan(0);
    expect(config.AGENT_MODEL).toBe("openrouter:deepseek/deepseek-v4-flash");
    expect(config.AGENT_MAX_STEPS).toBe(25);
    expect(config.AGENT_BASH_TIMEOUT_MS).toBe(120000);
    expect(config.AGENT_BASH_OUTPUT_MAX_BYTES).toBe(51200);
    expect(config.AGENT_READ_MAX_BYTES).toBe(262144);
    expect(config.AGENT_WRITE_MAX_BYTES).toBe(1048576);
    expect(config.AGENT_TOOL_TIMEOUT_MS).toBe(30000);
  });

  it("coerces and accepts configured agent settings", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://test",
      AGENT_MODEL: "test:model",
      AGENT_MAX_STEPS: "3",
      AGENT_BASH_TIMEOUT_MS: "1000",
      AGENT_BASH_OUTPUT_MAX_BYTES: "2048",
      AGENT_READ_MAX_BYTES: "4096",
      AGENT_WRITE_MAX_BYTES: "8192",
      AGENT_TOOL_TIMEOUT_MS: "5000",
    });

    expect(config).toMatchObject({
      AGENT_MODEL: "test:model",
      AGENT_MAX_STEPS: 3,
      AGENT_BASH_TIMEOUT_MS: 1000,
      AGENT_BASH_OUTPUT_MAX_BYTES: 2048,
      AGENT_READ_MAX_BYTES: 4096,
      AGENT_WRITE_MAX_BYTES: 8192,
      AGENT_TOOL_TIMEOUT_MS: 5000,
    });
  });

  it.each([
    ["AGENT_MAX_STEPS", "0"],
    ["AGENT_MAX_STEPS", "101"],
    ["AGENT_BASH_TIMEOUT_MS", "999"],
    ["AGENT_BASH_OUTPUT_MAX_BYTES", "1023"],
    ["AGENT_READ_MAX_BYTES", "1023"],
    ["AGENT_WRITE_MAX_BYTES", "1023"],
    ["AGENT_TOOL_TIMEOUT_MS", "999"],
  ])("rejects an invalid %s value", (key, value) => {
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://test", [key]: value }),
    ).toThrow();
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });
});
