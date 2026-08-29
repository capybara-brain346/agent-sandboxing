import type { AgentToolConfig } from "./config";
import type { AgentToolRuntime } from "./helpers";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createFindTool } from "./find";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";
import { createPublishPullRequestTool } from "./publish-pull-request";
import { createPullRequestTool } from "./pull-request";
import type { GitHubService } from "../../github/github";

export type AgentGitHubTools = Pick<
  GitHubService,
  "publishPullRequest" | "currentPullRequest" | "pullRequest"
>;

export const createToolRegistry = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
  context?: { sessionId: string; messageId: string },
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
        publish_pull_request: createPublishPullRequestTool(
          runtime,
          containerName,
          config,
          signal,
          context.sessionId,
          context.messageId,
          github,
        ),
        pull_request: createPullRequestTool(
          signal,
          context.sessionId,
          context.messageId,
          github,
        ),
      }
    : {}),
});

export const createAgentToolRegistry = createToolRegistry;
