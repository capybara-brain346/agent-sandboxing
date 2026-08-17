import { describe, expect, it, vi } from "vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { Config } from "../src/config";
import { resolveAgentModel } from "../src/services/agent/model";

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(),
}));

const baseConfig = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
  AGENT_MODEL: "openrouter:example/model",
  OPENROUTER_API_KEY: "secret-key",
} as Config;

describe("resolveAgentModel", () => {
  it("constructs the OpenRouter provider and resolves the configured model ID", () => {
    const model = { modelId: "example/model" };
    const provider = vi.fn(() => model);
    vi.mocked(createOpenRouter).mockReturnValue(provider);

    expect(resolveAgentModel(baseConfig)).toBe(model);
    expect(createOpenRouter).toHaveBeenCalledWith({ apiKey: "secret-key" });
    expect(provider).toHaveBeenCalledWith("example/model");
  });

  it.each(["example/model", "openrouter:"])(
    "rejects an invalid model setting: %s",
    (AGENT_MODEL) => {
      expect(() => resolveAgentModel({ ...baseConfig, AGENT_MODEL })).toThrow(
        /AGENT_MODEL/,
      );
    },
  );

  it("rejects a missing provider key even when called directly", () => {
    expect(() =>
      resolveAgentModel({ ...baseConfig, OPENROUTER_API_KEY: undefined }),
    ).toThrow(/OpenRouter/);
  });
});
