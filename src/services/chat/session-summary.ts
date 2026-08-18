export const SUMMARY_BYTE_CAP = 4000;
export const MAX_FILES = 15;
export const MAX_BLOCKERS = 5;

export const truncateBytes = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let result = text;
  while (result.length > 0 && Buffer.byteLength(result, "utf8") > maxBytes)
    result = result.slice(0, -1);
  return `${result.trimEnd()}…`;
};

export const truncateInline = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;

export const dedupe = (values: string[]): string[] => [...new Set(values)];

export const parseSection = (
  summary: string,
  key: string,
): string | undefined => {
  const match = new RegExp(`^${key}: (.*)$`, "m").exec(summary);
  return match?.[1]?.trim();
};
