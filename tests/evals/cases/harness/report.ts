import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvalResult } from "./types";

const reportPath = ".data/evals/agent-service.jsonl";

export const writeEvalReport = async (
  result: AgentEvalResult,
): Promise<string> => {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await appendFile(
    reportPath,
    `${JSON.stringify({ ...result, recordedAt: new Date().toISOString() })}\n`,
  );
  return reportPath;
};

export const agentEvalReportPath = reportPath;
