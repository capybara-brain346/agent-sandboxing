import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { canTransition, splitOutput, takeUtf8Prefix } from "../src/domain";

describe("configuration and domain boundaries", () => {
  it("loads safe defaults with a required database URL", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://test" });
    expect(config.SANDBOX_IMAGE).toBe("node:22-bookworm");
    expect(config.COMMAND_OUTPUT_MAX_BYTES).toBeGreaterThan(0);
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("allows only documented sandbox transitions and byte-bounds output", () => {
    expect(canTransition("creating", "ready")).toBe(true);
    expect(canTransition("ready", "creating")).toBe(false);
    expect(splitOutput("a".repeat(20), 8)).toEqual([
      "aaaaaaaa",
      "aaaaaaaa",
      "aaaa",
    ]);
    expect(splitOutput("ééé", 4)).toEqual(["éé", "é"]);
    expect(takeUtf8Prefix("ééé", 5)).toBe("éé");
  });
});
