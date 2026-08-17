import type { Config } from "../../../config";

/** Only the bounded tool settings are allowed to cross into tool closures. */
export type AgentToolConfig = Pick<
  Config,
  | "AGENT_BASH_TIMEOUT_MS"
  | "AGENT_BASH_OUTPUT_MAX_BYTES"
  | "AGENT_READ_MAX_BYTES"
  | "AGENT_WRITE_MAX_BYTES"
  | "AGENT_TOOL_TIMEOUT_MS"
>;
