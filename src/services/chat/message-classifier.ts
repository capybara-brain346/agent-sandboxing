import type { MessageIntent } from "../../types/harness.types";

export type { MessageIntent };

const CODE_INTENT_PATTERN =
  /\b(fix|add|implement|refactor|update|remove|delete|change|write|create|build|debug|test|migrate|rename|move|configure|install|upgrade|revert|clean\s?up)\b/i;

/**
 * Heuristic intent classifier: defaults to "code" for imperative/ambiguous
 * messages and only reads a message as "clarification" when it reads as a
 * plain question with no actionable verb.
 */
export const classifyMessage = (message: string): MessageIntent => {
  const trimmed = message.trim();
  if (!trimmed) return "clarification";
  if (CODE_INTENT_PATTERN.test(trimmed)) return "code";
  if (trimmed.endsWith("?")) return "clarification";
  return "code";
};
