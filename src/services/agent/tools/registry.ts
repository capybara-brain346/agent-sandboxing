import type { AgentToolConfig } from "./config";
import type { AgentToolRuntime } from "./helpers";
import type { ToolSet } from "ai";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createFindTool } from "./find";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";
import { createPublishPullRequestTool } from "./publish-pull-request";
import { createPullRequestTool } from "./pull-request";
import { createSubagentTool, type SubagentToolRunner } from "./subagent";
import type { GitHubService } from "../../github/github";
import {
  getToolProfile,
  loadToolProfiles,
  validateToolProfiles,
  type ToolProfileName,
} from "./profile-loader";

export type AgentGitHubTools = Pick<
  GitHubService,
  "publishPullRequest" | "currentPullRequest" | "pullRequest"
>;

type ToolFactoryDependencies = {
  runtime: AgentToolRuntime;
  containerName: string;
  config: AgentToolConfig;
  signal: AbortSignal;
  context?: { sessionId: string; messageId: string };
  github?: AgentGitHubTools;
  subagent?: SubagentToolRunner;
};

type ToolFactory = (dependencies: ToolFactoryDependencies) => unknown;

const toolFactories = {
  read: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createReadTool(runtime, containerName, config, signal),
  write: ({
    runtime,
    containerName,
    config,
    signal,
  }: ToolFactoryDependencies) =>
    createWriteTool(runtime, containerName, config, signal),
  edit: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createEditTool(runtime, containerName, config, signal),
  bash: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createBashTool(runtime, containerName, config, signal),
  grep: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createGrepTool(runtime, containerName, config, signal),
  find: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createFindTool(runtime, containerName, config, signal),
  ls: ({ runtime, containerName, config, signal }: ToolFactoryDependencies) =>
    createLsTool(runtime, containerName, config, signal),
  publish_pull_request: ({
    runtime,
    containerName,
    config,
    signal,
    context,
    github,
  }: ToolFactoryDependencies) =>
    context && github
      ? createPublishPullRequestTool(
          runtime,
          containerName,
          config,
          signal,
          context.sessionId,
          context.messageId,
          github,
        )
      : undefined,
  pull_request: ({ signal, context, github }: ToolFactoryDependencies) =>
    context && github
      ? createPullRequestTool(
          signal,
          context.sessionId,
          context.messageId,
          github,
        )
      : undefined,
  subagent: ({ signal, subagent }: ToolFactoryDependencies) =>
    subagent ? createSubagentTool(subagent, signal) : undefined,
} satisfies Record<string, ToolFactory>;

const toolProfiles = loadToolProfiles();
validateToolProfiles(toolProfiles, Object.keys(toolFactories));

export const createToolRegistry = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
  context?: { sessionId: string; messageId: string },
  github?: AgentGitHubTools,
  profile: ToolProfileName = "main",
  subagent?: SubagentToolRunner,
) => {
  const selectedProfile = getToolProfile(toolProfiles, profile);
  const selectedNames =
    "all" in selectedProfile
      ? Object.keys(toolFactories)
      : selectedProfile.tools;
  const factories = toolFactories as Record<string, ToolFactory>;
  const entries = selectedNames.flatMap((name) => {
    const tool = factories[name]?.({
      runtime,
      containerName,
      config,
      signal,
      ...(context ? { context } : {}),
      ...(github ? { github } : {}),
      ...(subagent ? { subagent } : {}),
    });
    return tool === undefined ? [] : [[name, tool] as const];
  });
  return Object.fromEntries(entries) as ToolSet;
};

export const createAgentToolRegistry = createToolRegistry;
