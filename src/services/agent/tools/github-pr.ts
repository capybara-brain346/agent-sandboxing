import { tool } from "ai";
import type { Config } from "../../../config";
import type {
  GitHubPullRequestActionInput,
  GitHubService,
} from "../../github/github";
import type { GitHubPullRequestToolResult } from "../../../types/github.types";
import { ServiceError } from "../../../shared/errors";
import { z } from "zod";

type GitHubPrService = Pick<GitHubService, "pullRequest">;

const inputSchema = z
  .object({
    action: z.enum(["create", "update", "comment", "close", "reopen"]),
    branch: z.string().trim().min(1).optional(),
    baseBranch: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    body: z.string().max(32_000).optional(),
    draft: z.boolean().optional(),
    number: z.number().int().positive().optional(),
    comment: z.string().trim().min(1).max(32_000).optional(),
    supersedeExisting: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "create" && !input.branch)
      context.addIssue({
        code: "custom",
        path: ["branch"],
        message: "Branch is required",
      });
    if (input.action === "create" && !input.title)
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Title is required",
      });
    if (input.action === "comment" && !input.comment)
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "Comment is required",
      });
  });

const failure = (
  action: GitHubPullRequestToolResult["action"],
  code: string,
  message: string,
): GitHubPullRequestToolResult => ({
  success: false,
  action,
  pullRequest: null,
  failure: { code, message },
  github: null,
});

export const createGitHubPrTool = (
  _config: Pick<Config, "AGENT_TOOL_TIMEOUT_MS">,
  signal: AbortSignal,
  sessionId: string,
  runId: string,
  github: GitHubPrService,
) =>
  tool({
    description:
      "Create or manage a GitHub pull request for this session when it is useful.",
    inputSchema,
    execute: async (input) => {
      if (signal.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      try {
        return await github.pullRequest(
          sessionId,
          runId,
          input as GitHubPullRequestActionInput,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof ServiceError)
          return failure(input.action, error.code, error.message);
        throw error;
      }
    },
  });

export const githubPrTool = createGitHubPrTool;
