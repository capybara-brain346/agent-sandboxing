type Level = "debug" | "info" | "warn" | "error";
type ColorMode = "auto" | "true" | "false";

const severity: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const colors: Record<Level, string> = {
  debug: "\u001b[90m",
  info: "\u001b[32m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

let configuredLevel: Level = process.env.NODE_ENV === "test" ? "error" : "info";
let configuredColor: ColorMode = "auto";

export const configureLogger = ({
  level,
  color,
}: {
  level: Level;
  color: ColorMode;
}): void => {
  configuredLevel = level;
  configuredColor = color;
};

const shouldColor = (level: Level): boolean => {
  if (configuredColor === "true") return true;
  if (configuredColor === "false") return false;
  return level === "warn" || level === "error"
    ? process.stderr.isTTY === true
    : process.stdout.isTTY === true;
};

const write = (
  level: Level,
  event: string,
  fields: Record<string, unknown>,
): void => {
  if (severity[level] < severity[configuredLevel]) return;
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...fields,
  });
  const output = shouldColor(level) ? `${colors[level]}${line}\u001b[0m` : line;
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
};

export const logger = {
  debug: (event: string, fields: Record<string, unknown> = {}): void =>
    write("debug", event, fields),
  info: (event: string, fields: Record<string, unknown> = {}): void =>
    write("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}): void =>
    write("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}): void =>
    write("error", event, fields),
};
