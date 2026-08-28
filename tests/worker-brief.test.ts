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

  it("treats explicit pull request requests as worker-owned tool work", () => {
    const context = {
      summary: "",
      workspace: {
        hasPriorRun: false,
        lastRunStatus: null,
        lastRunSummary: null,
        changedFilesHint: [],
      },
    };
    const brief = buildWorkerBrief(context, "enable mouse and raise the pr");

    expect(brief).toContain("use publish_pull_request");
    expect(brief).toContain("do not give manual git or gh instructions");
  });
});
