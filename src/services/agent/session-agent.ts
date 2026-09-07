import type { AgentResult } from "../../types/harness.types";
import type { MessageProcessingContext } from "../../types/message-processing.types";

export type SessionAgent = {
  process(context: MessageProcessingContext): Promise<AgentResult>;
};
