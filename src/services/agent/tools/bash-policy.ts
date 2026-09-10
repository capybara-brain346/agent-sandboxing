import { ServiceError } from "../../../shared/errors";

export const validateBashCommand = (command: string): string => {
  if (typeof command !== "string" || command.trim().length === 0)
    throw new ServiceError("unsafe_command", "Command must not be empty", 422);
  return command;
};
