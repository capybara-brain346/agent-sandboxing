import type { AgentToolConfig } from "./config";
import type { AgentToolRuntime } from "./helpers";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createFindTool } from "./find";
import { createGrepTool } from "./grep";
import { createLsTool } from "./ls";
import { createReadTool } from "./read";
import { createWriteTool } from "./write";

export const createToolRegistry = (
  runtime: AgentToolRuntime,
  containerName: string,
  config: AgentToolConfig,
  signal: AbortSignal,
) => ({
  read: createReadTool(runtime, containerName, config, signal),
  write: createWriteTool(runtime, containerName, config, signal),
  edit: createEditTool(runtime, containerName, config, signal),
  bash: createBashTool(runtime, containerName, config, signal),
  grep: createGrepTool(runtime, containerName, config, signal),
  find: createFindTool(runtime, containerName, config, signal),
  ls: createLsTool(runtime, containerName, config, signal),
});

export const createAgentToolRegistry = createToolRegistry;
