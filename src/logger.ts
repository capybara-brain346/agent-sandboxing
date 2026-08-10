type Level = "debug" | "info" | "warn" | "error";

const write = (
  level: Level,
  event: string,
  fields: Record<string, unknown>,
): void => {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
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
