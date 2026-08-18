const SUMMARY_BYTE_CAP = 4000;
const MAX_FILES = 15;
const MAX_BLOCKERS = 5;

export type SummaryOutcomeKind =
  "clarification" | "worker_completed" | "worker_blocked" | "worker_failed";

export type SummaryUpdateInput = {
  previousSummary: string;
  userMessage: string;
  outcome: {
    kind: SummaryOutcomeKind;
    summary: string;
    changedFiles: string[];
    blockers: string[];
  };
};

const truncateBytes = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let result = text;
  while (result.length > 0 && Buffer.byteLength(result, "utf8") > maxBytes)
    result = result.slice(0, -1);
  return `${result.trimEnd()}…`;
};

const truncateInline = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;

const dedupe = (values: string[]): string[] => [...new Set(values)];

const stateLine = (kind: SummaryOutcomeKind): string => {
  switch (kind) {
    case "clarification":
      return "State: awaiting user clarification.";
    case "worker_completed":
      return "State: last worker run completed.";
    case "worker_blocked":
      return "State: last worker run was blocked and needs follow-up.";
    case "worker_failed":
      return "State: last worker run failed.";
  }
};

const parseSection = (summary: string, key: string): string | undefined => {
  const match = new RegExp(`^${key}: (.*)$`, "m").exec(summary);
  return match?.[1]?.trim();
};

const parseFiles = (summary: string): string[] => {
  const files = parseSection(summary, "Files");
  if (!files || files === "none") return [];
  return files
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
};

/**
 * Rewrites the bounded session working-state document. This is a rewrite,
 * not an append: State/LastResult/Blockers reflect only the current turn,
 * while Objective (set once) and Files (union, capped) persist across turns.
 */
export class SessionSummaryService {
  rewrite(input: SummaryUpdateInput): string {
    const objective =
      parseSection(input.previousSummary, "Objective") ??
      truncateInline(input.userMessage.trim(), 200);

    const files = dedupe([
      ...parseFiles(input.previousSummary),
      ...input.outcome.changedFiles,
    ]).slice(-MAX_FILES);

    const blockers = input.outcome.blockers.slice(0, MAX_BLOCKERS);
    const lastResult = truncateInline(input.outcome.summary.trim(), 400);

    const lines = [
      `Objective: ${objective}`,
      stateLine(input.outcome.kind),
      lastResult ? `LastResult: ${lastResult}` : null,
      `Files: ${files.length ? files.join(", ") : "none"}`,
      `Blockers: ${blockers.length ? blockers.join("; ") : "none"}`,
    ].filter((line): line is string => line !== null);

    let currentFiles = files;
    let text = lines.join("\n");
    while (
      currentFiles.length > 0 &&
      Buffer.byteLength(text, "utf8") > SUMMARY_BYTE_CAP
    ) {
      currentFiles = currentFiles.slice(1);
      lines[lines.length - 2] = `Files: ${
        currentFiles.length ? currentFiles.join(", ") : "none"
      }`;
      text = lines.join("\n");
    }

    return truncateBytes(text, SUMMARY_BYTE_CAP);
  }
}
