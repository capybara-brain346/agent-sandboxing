import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../../config";
import { ServiceError } from "../../../shared/errors";
import type { GitHubService } from "../../github/github";
import type { GitHubPullRequestToolResult } from "../../../types/github.types";
import type { AgentToolRuntime } from "./helpers";
import { throwIfAborted } from "./helpers";

type PublishPullRequestService = Pick<GitHubService, "publishPullRequest">;

const inputSchema = z
  .object({
    title: z.string().trim().min(1),
    body: z.string().max(32_000).optional(),
    draft: z.boolean().optional(),
  })
  .strict();

const failure = (
  code: string,
  message: string,
): GitHubPullRequestToolResult => ({
  success: false,
  action: "publish",
  pullRequest: null,
  failure: { code, message },
  github: null,
});

export const createPublishPullRequestTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: Pick<Config, "AGENT_TOOL_TIMEOUT_MS">,
  signal: AbortSignal,
  sessionId: string,
  messageId: string,
  github: PublishPullRequestService,
) =>
  tool({
    description:
      "Publish the current workspace changes as a GitHub pull request. The backend owns branch creation, commit, push, and PR creation.",
    inputSchema,
    execute: async (input) => {
      throwIfAborted(signal);
      try {
        return await github.publishPullRequest(
          sessionId,
          messageId,
          { runtime, containerName },
          input,
          { timeoutMs: config.AGENT_TOOL_TIMEOUT_MS, signal },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof ServiceError)
          return failure(error.code, error.message);
        throw error;
      }
    },
  });

export const publishPullRequestTool = createPublishPullRequestTool;
