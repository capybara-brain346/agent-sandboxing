import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../../config";
import type { GitHubService } from "../../github/github";
import { ServiceError } from "../../../shared/errors";
import { workspaceRoot } from "../../sandbox/workspace";
import type { AgentToolRuntime } from "./helpers";
import { hasControlCharacter, shellQuote, throwIfAborted } from "./helpers";
import type { GitHubPullRequestToolResult } from "../../../types/github.types";

type GitPushService = Pick<
  GitHubService,
  | "sessionRepository"
  | "createInstallationToken"
  | "currentPullRequest"
  | "recordGitPushEvent"
>;

const inputSchema = z
  .object({
    branch: z.string().trim().min(1).optional(),
    remote: z.string().trim().min(1).optional(),
  })
  .strict();

const validGitArgument = (value: string): boolean =>
  !value.startsWith("-") &&
  !/\s/.test(value) &&
  !hasControlCharacter(value) &&
  !/[+:?*]/.test(value) &&
  !value.includes("[") &&
  !value.includes("]") &&
  !value.includes("\\") &&
  !/[\^~]/.test(value) &&
  !value.includes("..") &&
  !value.includes("@{");

const isExpectedGitHubRemote = (
  value: string,
  owner: string,
  name: string,
): boolean => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const path = decodeURIComponent(url.pathname)
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    return path.toLowerCase() === `/${owner}/${name}`.toLowerCase();
  } catch {
    return false;
  }
};

const failure = (
  pullRequest: GitHubPullRequestToolResult["pullRequest"],
  code: string,
  message: string,
): GitHubPullRequestToolResult => ({
  success: false,
  action: "push",
  pullRequest,
  failure: { code, message },
  github: null,
});

const success = (
  pullRequest: GitHubPullRequestToolResult["pullRequest"],
): GitHubPullRequestToolResult => ({
  success: true,
  action: "push",
  pullRequest,
  failure: null,
  github: null,
});

const sameBranch = (left: string | null, right: string): boolean =>
  left?.toLowerCase() === right.toLowerCase();

export const createGitPushTool = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: Pick<Config, "AGENT_TOOL_TIMEOUT_MS">,
  signal: AbortSignal,
  sessionId: string,
  runId: string,
  github: GitPushService,
) =>
  tool({
    description:
      "Push the current workspace branch to GitHub using a platform-managed credential.",
    inputSchema,
    execute: async ({ branch: requestedBranch, remote: requestedRemote }) => {
      throwIfAborted(signal);
      const pullRequest = null;
      const failed = async (
        code: string,
        message: string,
        branch = requestedBranch ?? "",
      ) => {
        await github.recordGitPushEvent(sessionId, runId, branch, {
          code,
          message,
        });
        return failure(pullRequest, code, message);
      };
      if (requestedBranch && !validGitArgument(requestedBranch))
        return failed(
          "invalid_git_branch",
          "The branch name is not a valid Git reference",
        );
      if (requestedRemote && !validGitArgument(requestedRemote))
        return failed("invalid_git_remote", "The remote name is not valid");

      const remote = requestedRemote ?? "origin";
      let branch = requestedBranch;
      if (!branch) {
        const current = await runtime.simpleExec(
          containerName,
          "git branch --show-current",
          workspaceRoot,
          { timeoutMs: config.AGENT_TOOL_TIMEOUT_MS, signal },
        );
        if (
          current.exitCode !== 0 ||
          current.timedOut ||
          !current.stdout.trim()
        )
          return failed(
            "git_branch_lookup_failed",
            "The current Git branch could not be determined",
          );
        branch = current.stdout.trim();
      }
      if (!validGitArgument(branch))
        return failed(
          "invalid_git_branch",
          "The branch name is not a valid Git reference",
        );

      let repository;
      try {
        repository = await github.sessionRepository(sessionId);
        if (
          sameBranch(repository.baseBranch, branch) ||
          sameBranch(repository.defaultBranch, branch)
        )
          return failed(
            "protected_git_branch",
            "Refusing to push the session base branch",
            branch,
          );
        const configuredRemote = await runtime.simpleExec(
          containerName,
          `git remote get-url --push ${shellQuote(remote)}`,
          workspaceRoot,
          { timeoutMs: config.AGENT_TOOL_TIMEOUT_MS, signal },
        );
        if (
          configuredRemote.exitCode !== 0 ||
          configuredRemote.timedOut ||
          !isExpectedGitHubRemote(
            configuredRemote.stdout.trim(),
            repository.owner,
            repository.name,
          )
        )
          return failed(
            "git_remote_mismatch",
            "The configured Git remote does not match the session repository",
            branch,
          );
        const token = await github.createInstallationToken(
          repository.installationId,
        );
        const result = await runtime.simpleExec(
          containerName,
          `token=$(cat) && export GITHUB_TOKEN="$token" GIT_TERMINAL_PROMPT=0 && git -c core.hooksPath=/dev/null -c credential.helper= -c ${shellQuote('credential.helper=!f() { echo username=x-access-token; echo password="$GITHUB_TOKEN"; }; f')} push --no-verify ${shellQuote(remote)} ${shellQuote(`HEAD:refs/heads/${branch}`)}`,
          workspaceRoot,
          {
            timeoutMs: config.AGENT_TOOL_TIMEOUT_MS,
            signal,
            stdin: token,
          },
        );
        if (result.exitCode !== 0 || result.timedOut)
          return failed(
            result.timedOut ? "git_push_timed_out" : "git_push_rejected",
            result.timedOut
              ? "Git push timed out"
              : "GitHub rejected the Git push",
          );
        try {
          await github.recordGitPushEvent(sessionId, runId, branch);
          return success(await github.currentPullRequest(sessionId));
        } catch {
          return success(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        return failed(
          error instanceof ServiceError ? error.code : "git_push_failed",
          error instanceof ServiceError
            ? error.message
            : "Git push could not be completed",
        );
      }
    },
  });

export const gitPushTool = createGitPushTool;
