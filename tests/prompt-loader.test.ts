import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPromptText } from "../src/prompts/load-prompt";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("prompt loader", () => {
  it("loads an evaluation prompt from its configured path", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-prompts-"));
    try {
      await writeFile(
        path.join(directory, "subagent.yaml"),
        "id: subagent\nversion: 1\nupdated_at: 2026-01-01\ndescription: test\nprompt: evaluation prompt\n",
        "utf8",
      );
      vi.stubEnv("AGENT_PROMPTS_PATH", directory);
      expect(getPromptText("subagent")).toBe("evaluation prompt");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
