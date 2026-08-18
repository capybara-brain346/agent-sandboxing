import { logger } from "../logger";
import { ServiceError } from "./errors";

const describeQueryError = (error: unknown): Record<string, unknown> =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { value: error };

export const logQueryFailure = (
  operation: string,
  context: Record<string, unknown>,
  error: unknown,
): void =>
  logger.error("query_failed", {
    operation,
    ...context,
    error: describeQueryError(error),
  });

export const runQuery = async <T>(
  operation: string,
  context: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof ServiceError))
      logQueryFailure(operation, context, error);
    throw error;
  }
};
