import { describe, expect, it } from "vitest";
import { classifyMessage } from "../src/services/chat/message-classifier";

describe("classifyMessage", () => {
  it("classifies imperative code requests as code", () => {
    expect(classifyMessage("Fix the failing login test")).toBe("code");
    expect(classifyMessage("Add a retry to the fetch call")).toBe("code");
  });

  it("classifies plain questions with no action verb as clarification", () => {
    expect(classifyMessage("What does this service do?")).toBe("clarification");
    expect(classifyMessage("Is the sandbox reused across runs?")).toBe(
      "clarification",
    );
  });

  it("defaults ambiguous non-question text to code", () => {
    expect(classifyMessage("looks good")).toBe("code");
  });

  it("treats empty input as clarification", () => {
    expect(classifyMessage("   ")).toBe("clarification");
  });

  it("prefers code intent over trailing question mark when an action verb is present", () => {
    expect(classifyMessage("Can you fix the build?")).toBe("code");
  });
});
