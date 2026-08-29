import { describe, expect, it } from "vitest";
import { buildWorkerBrief } from "../src/services/agent/worker-brief";
import { getPromptText } from "../src/prompts/load-prompt";

describe("buildWorkerBrief", () => {
  it("uses only the container workspace path", () => {
    const context = {
      repoRef: "/workspace/fixture-repo",
      summary: "",
      workspace: {
        hasPriorProcessing: false,
        lastProcessingStatus: null,
        lastProcessingSummary: null,
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
        hasPriorProcessing: false,
        lastProcessingStatus: null,
        lastProcessingSummary: null,
        changedFilesHint: [],
      },
    };
    const brief = buildWorkerBrief(context, "enable mouse and raise the pr");

    expect(brief).toContain("use publish_pull_request");
    expect(brief).toContain("do not give manual git or gh instructions");
  });

  it("requires a returned pull request URL before reporting PR success", () => {
    const context = {
      summary: "",
      workspace: {
        hasPriorProcessing: false,
        lastProcessingStatus: null,
        lastProcessingSummary: null,
        changedFilesHint: [],
      },
    };
    const brief = buildWorkerBrief(context, "change the README and raise a PR");

    expect(brief).toContain("After any publish_pull_request call");
    expect(brief).toContain("success with a pull request URL");
    expect(brief).toContain(
      "not published because there was no workspace diff",
    );
  });

  it("uses prior context wording instead of internal harness labels", () => {
    const context = {
      summary: "Objective: fix docs",
      workspace: {
        hasPriorProcessing: true,
        lastProcessingStatus: "completed",
        lastProcessingSummary: "done",
        changedFilesHint: ["README.md"],
      },
    };
    const brief = buildWorkerBrief(context, "continue", "blocked earlier");

    expect(brief).toContain("Prior context:");
    expect(brief).toContain("Previous attempt report:");
    expect(brief).not.toContain("CodeWorker");
    expect(brief).not.toContain("Session summary:");
    expect(brief).not.toContain("worker report");
  });

  it("loads prompt contracts that prevent PR success laundering", () => {
    expect(getPromptText("code-worker")).toContain(
      "Pull request: published at <url>",
    );
    expect(getPromptText("orchestrator")).toContain(
      "unless the worker reported a published pull request URL",
    );
  });
});
