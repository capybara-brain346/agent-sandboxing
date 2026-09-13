import { ServiceError } from "../../../shared/errors";

export const validateBashCommand = (command: string): string => {
  if (typeof command !== "string" || command.trim().length === 0)
    throw new ServiceError("unsafe_command", "Command must not be empty", 422);
  if (/(?:^|(?:&&|\|\||[;|])\s*)git\s+(?:commit|push)\b/.test(command))
    throw new ServiceError(
      "unsafe_command",
      "Use the pull request tool to commit and publish changes",
      422,
    );
  return command;
};
