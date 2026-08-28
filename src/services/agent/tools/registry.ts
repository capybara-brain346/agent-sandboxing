import type { AgentToolConfig } from "./config";
import type { AgentToolRuntime } from "./helpers";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createFindTool } from "./find";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";
import { createGitPushTool } from "./git-push";
import { createGitHubPrTool } from "./github-pr";
import type { GitHubService } from "../../github/github";

export type AgentGitHubTools = Pick<
  GitHubService,
  | "sessionRepository"
  | "createInstallationToken"
  | "currentPullRequest"
  | "recordGitPushEvent"
  | "pullRequest"
>;

export const createToolRegistry = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
  context?: { sessionId: string; runId: string },
  github?: AgentGitHubTools,
) => ({
  read: createReadTool(runtime, containerName, config, signal),
  write: createWriteTool(runtime, containerName, config, signal),
  edit: createEditTool(runtime, containerName, config, signal),
  bash: createBashTool(runtime, containerName, config, signal),
  grep: createGrepTool(runtime, containerName, config, signal),
  find: createFindTool(runtime, containerName, config, signal),
  ls: createLsTool(runtime, containerName, config, signal),
  ...(context && github
    ? {
        git_push: createGitPushTool(
          runtime,
          containerName,
          config,
          signal,
          context.sessionId,
          context.runId,
          github,
        ),
        github_pr: createGitHubPrTool(
          config,
          signal,
          context.sessionId,
          context.runId,
          github,
        ),
      }
    : {}),
});

export const createAgentToolRegistry = createToolRegistry;
