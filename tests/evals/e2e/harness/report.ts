import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { EvalAttempt } from "./types";

const reportPath =
  process.env.E2E_REPORT_PATH ?? ".data/evals/e2e/capynodes.jsonl";

const secretValues = [
  process.env.E2E_AUTH_COOKIE_SECRET,
  process.env.AUTH_COOKIE_SECRET,
  process.env.OPENROUTER_API_KEY,
  process.env.GITHUB_APP_PRIVATE_KEY,
  process.env.GITHUB_CLIENT_SECRET,
].filter((value): value is string => Boolean(value && value.length > 3));

const safeText = (value: string): string => {
  let safe = value;
  for (const secret of secretValues)
    safe = safe.replaceAll(secret, "[REDACTED]");
  return safe.replaceAll(
    /(?:authorization|cookie|secret|token|password)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  );
};

export const serializeEvalAttempt = (
  attempt: EvalAttempt,
  recordedAt = new Date().toISOString(),
): string =>
  JSON.stringify({ ...attempt, recordedAt }, (_key, value: unknown) =>
    typeof value === "string" ? safeText(value) : value,
  );

export const writeEvalAttempt = async (
  attempt: EvalAttempt,
): Promise<string> => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await appendFile(reportPath, `${serializeEvalAttempt(attempt)}\n`);
  return reportPath;
};

export const capyNodesEvalReportPath = reportPath;
