import { describe, expect, it } from "vitest";
import { buildWorkerBrief } from "../src/services/agent/worker-brief";

describe("buildWorkerBrief", () => {
  it("uses only the container workspace path", () => {
    const context = {
      repoRef: "/workspace/fixture-repo",
      summary: "",
      workspace: {
        hasPriorRun: false,
        lastRunStatus: null,
        lastRunSummary: null,
        changedFilesHint: [],
      },
    };
    const brief = buildWorkerBrief(context, "read the README");

    expect(brief).toContain("/workspace/repo");
    expect(brief).not.toContain("/workspace/fixture-repo");
  });
});
