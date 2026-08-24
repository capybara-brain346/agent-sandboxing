import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("configuration", () => {
  it("loads safe defaults with a required database URL", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
    });
    expect(config.SANDBOX_IMAGE).toBe("node:22-bookworm");
    expect(config.COMMAND_OUTPUT_MAX_BYTES).toBeGreaterThan(0);
    expect(config.AGENT_MODEL).toBe("openrouter:deepseek/deepseek-v4-flash");
    expect(config.AGENT_MAX_STEPS).toBe(25);
    expect(config.AGENT_BASH_TIMEOUT_MS).toBe(120000);
    expect(config.AGENT_BASH_OUTPUT_MAX_BYTES).toBe(51200);
    expect(config.AGENT_READ_MAX_BYTES).toBe(262144);
    expect(config.AGENT_WRITE_MAX_BYTES).toBe(1048576);
    expect(config.AGENT_TOOL_TIMEOUT_MS).toBe(30000);
    expect(config.LANGFUSE_ENABLED).toBe(false);
    expect(config.LANGFUSE_FLUSH_TIMEOUT_MS).toBe(2000);
    expect(config.LOCAL_TRACE_EXPORT_ENABLED).toBe(false);
  });

  it("coerces and accepts configured agent settings", () => {
    const config = loadConfig({
      NODE_ENV: "test",
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
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        [key]: value,
      }),
    ).toThrow();
  });

  it("rejects missing OpenRouter configuration outside test mode", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://test",
      }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it("accepts the OpenRouter key outside test mode without exposing it in other settings", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test",
      OPENROUTER_API_KEY: "test-key",
    });

    expect(config.OPENROUTER_API_KEY).toBe("test-key");
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("requires both Langfuse keys only when enabled", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        LANGFUSE_ENABLED: "true",
      }),
    ).toThrow(/LANGFUSE_PUBLIC_KEY/);

    expect(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        LANGFUSE_ENABLED: "true",
        LANGFUSE_PUBLIC_KEY: "pk-test",
        LANGFUSE_SECRET_KEY: "sk-test",
      }),
    ).toMatchObject({
      LANGFUSE_ENABLED: true,
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
    });
  });

  it("treats blank optional Langfuse values as unset", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      LANGFUSE_PUBLIC_KEY: "",
      LANGFUSE_SECRET_KEY: "",
      LANGFUSE_BASE_URL: "",
    });

    expect(config.LANGFUSE_PUBLIC_KEY).toBeUndefined();
    expect(config.LANGFUSE_SECRET_KEY).toBeUndefined();
    expect(config.LANGFUSE_BASE_URL).toBeUndefined();
  });
});
