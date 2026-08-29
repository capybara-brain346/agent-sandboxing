import { tool } from "ai";
import { z } from "zod";
import { ServiceError } from "../../../shared/errors";
import type {
  GitHubPullRequestActionInput,
  GitHubService,
} from "../../github/github";
import type { GitHubPullRequestToolResult } from "../../../types/github.types";
import { throwIfAborted } from "./helpers";

type PullRequestService = Pick<
  GitHubService,
  "currentPullRequest" | "pullRequest"
>;

const numberSchema = z.number().int().positive().optional();
const shortTextSchema = z.string().trim().min(1);
const longTextSchema = z.string().max(32_000);

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("read"),
      number: numberSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      number: numberSchema,
      title: shortTextSchema.optional(),
      body: longTextSchema.optional(),
      baseBranch: shortTextSchema.optional(),
      draft: z.boolean().optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.title !== undefined ||
        input.body !== undefined ||
        input.baseBranch !== undefined ||
        input.draft !== undefined,
      "At least one pull request update field is required",
    ),
  z
    .object({
      action: z.literal("comment"),
      number: numberSchema,
      comment: shortTextSchema.max(32_000),
    })
    .strict(),
  z
    .object({
      action: z.union([z.literal("close"), z.literal("reopen")]),
      number: numberSchema,
    })
    .strict(),
]);

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

export const createPullRequestTool = (
  signal: AbortSignal,
  sessionId: string,
  messageId: string,
  github: PullRequestService,
) =>
  tool({
    description:
      "Read or modify an existing GitHub pull request associated with this chat session.",
    inputSchema,
    execute: async (rawInput) => {
      const input = inputSchema.parse(rawInput);
      throwIfAborted(signal);
      try {
        if (input.action === "read") {
          const pullRequest = await github.currentPullRequest(sessionId);
          return {
            success: true,
            action: "read" as const,
            pullRequest,
            failure: null,
            github: null,
          };
        }
        return await github.pullRequest(
          sessionId,
          messageId,
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

export const pullRequestTool = createPullRequestTool;
