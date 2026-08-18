import { describe, expect, it } from "vitest";
import { SessionSummaryService } from "../src/services/chat/session-summary";

describe("SessionSummaryService", () => {
  it("sets the objective from the first user message and carries it forward", () => {
    const service = new SessionSummaryService();
    const first = service.rewrite({
      previousSummary: "",
      userMessage: "Add auth middleware",
      outcome: {
        kind: "worker_completed",
        summary: "Added middleware",
        changedFiles: ["src/auth.ts"],
        blockers: [],
      },
    });
    expect(first).toContain("Objective: Add auth middleware");

    const second = service.rewrite({
      previousSummary: first,
      userMessage: "Now add tests",
      outcome: {
        kind: "worker_completed",
        summary: "Added tests",
        changedFiles: ["tests/auth.test.ts"],
        blockers: [],
      },
    });
    expect(second).toContain("Objective: Add auth middleware");
    expect(second).toContain("src/auth.ts");
    expect(second).toContain("tests/auth.test.ts");
  });

  it("replaces state and blockers each turn instead of appending them", () => {
    const service = new SessionSummaryService();
    const blocked = service.rewrite({
      previousSummary: "",
      userMessage: "Add feature X",
      outcome: {
        kind: "worker_blocked",
        summary: "Needs API key",
        changedFiles: [],
        blockers: ["missing API key"],
      },
    });
    expect(blocked).toContain("Blockers: missing API key");

    const resolved = service.rewrite({
      previousSummary: blocked,
      userMessage: "Here is the key",
      outcome: {
        kind: "worker_completed",
        summary: "Feature X done",
        changedFiles: ["src/x.ts"],
        blockers: [],
      },
    });
    expect(resolved).toContain("Blockers: none");
    expect(resolved).not.toContain("missing API key");
  });

  it("stays within the byte budget by dropping oldest files first", () => {
    const service = new SessionSummaryService();
    let summary = "";
    for (let i = 0; i < 200; i++) {
      summary = service.rewrite({
        previousSummary: summary,
        userMessage: `Change ${i}`,
        outcome: {
          kind: "worker_completed",
          summary: `Change ${i} applied with a fairly long free-text description of the work`,
          changedFiles: [`src/file-${i}.ts`],
          blockers: [],
        },
      });
      expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(4000);
    }
  });

  it("marks awaiting clarification state without recording files or blockers", () => {
    const service = new SessionSummaryService();
    const summary = service.rewrite({
      previousSummary: "",
      userMessage: "what does this do?",
      outcome: {
        kind: "clarification",
        summary: "It's a repo-scoped chat session.",
        changedFiles: [],
        blockers: [],
      },
    });
    expect(summary).toContain("State: awaiting user clarification.");
    expect(summary).toContain("Files: none");
  });
});
