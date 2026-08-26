import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { AgentModelConfig } from "../../config";
import { ServiceError } from "../../shared/errors";

const OPENROUTER_MODEL_PREFIX = "openrouter:";

export const resolveAgentModel = (config: AgentModelConfig): LanguageModel => {
  if (!config.AGENT_MODEL.startsWith(OPENROUTER_MODEL_PREFIX))
    throw new ServiceError(
      "invalid_agent_model",
      "AGENT_MODEL must use the openrouter:<model-id> format",
      500,
    );

  const modelId = config.AGENT_MODEL.slice(OPENROUTER_MODEL_PREFIX.length);
  if (!modelId.trim())
    throw new ServiceError(
      "invalid_agent_model",
      "AGENT_MODEL must include an OpenRouter model ID",
      500,
    );

  if (!config.OPENROUTER_API_KEY)
    throw new ServiceError(
      "agent_provider_unconfigured",
      "OpenRouter is not configured",
      500,
    );

  const openrouter = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });
  return openrouter(modelId);
};
