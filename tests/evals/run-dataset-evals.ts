import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { LanguageModel } from "ai";
import { loadAgentModelConfig } from "../../src/config";
import {
  ModelOrchestratorAgent,
  type OrchestratorAgentInput,
} from "../../src/services/agent/orchestrator-agent";
import { resolveAgentModel } from "../../src/services/agent/model";
import {
  failedScoreNames,
  allDatasetScoresPass,
  passesDatasetSuiteThreshold,
  scoreDatasetCase,
  workerResult,
} from "./scorers";
import { runSubjectiveJudge, subjectiveScoreSummary } from "./subjective-judge";
import {
  datasetCaseSchema,
  type DatasetCase,
  type DatasetEvalResult,
  type DatasetObserved,
} from "./types";
import { appendResult, prepareResultFile } from "./result-files";

const DEFAULT_CASES_PATH = join(
  process.cwd(),
  "tests/evals/cases/dataset.jsonl",
);
const DEFAULT_RESULTS_DIR = join(process.cwd(), "tests/evals/results");

export const loadDatasetCases = (path = DEFAULT_CASES_PATH): DatasetCase[] =>
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [datasetCaseSchema.parse(JSON.parse(line))];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid dataset case at ${path}:${index + 1}: ${message}`,
          { cause: error },
        );
      }
    });

const runCase = async (
  agent: ModelOrchestratorAgent,
  testCase: DatasetCase,
  judgeModel?: LanguageModel,
): Promise<DatasetEvalResult> => {
  const briefs: string[] = [];
  const delegations: DatasetCase["workerResults"] = [];
  let resultIndex = 0;
  const signal = new AbortController().signal;
  const delegate: OrchestratorAgentInput["delegate"] = async (brief) => {
    briefs.push(brief);
    const result = testCase.workerResults[resultIndex] ?? workerResult();
    resultIndex += 1;
    delegations.push(result);
    return result;
  };

  let observed: DatasetObserved;
  try {
    const decision = await agent.decide({
      ...testCase.input,
      messageId: `eval-${testCase.id}`,
      signal,
      delegate,
    });
    observed = {
      reply: decision.reply,
      delegations: decision.delegations,
      briefs,
    };
  } catch (error) {
    observed = {
      reply: "",
      delegations,
      briefs,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const scores = scoreDatasetCase(testCase, observed);
  const result: DatasetEvalResult = {
    caseId: testCase.id,
    suite: testCase.suite,
    status: allDatasetScoresPass(scores) ? "passed" : "failed",
    scores,
    observed: {
      ...observed,
      delegationCount: observed.delegations.length,
      delegationStatuses: observed.delegations.map((result) => result.status),
    },
  };
  if (!judgeModel) return result;
  return {
    ...result,
    subjectiveJudge: await runSubjectiveJudge(
      judgeModel,
      {
        caseId: testCase.id,
        suite: testCase.suite,
        task: testCase.input.message,
        context: {
          summary: testCase.input.summary,
          recentMessages: testCase.input.recentMessages,
          recentToolActivity: testCase.input.recentToolActivity,
          workspace: testCase.input.workspace,
        },
        observed,
      },
      signal,
    ),
  };
};

const printReport = (
  results: DatasetEvalResult[],
  resultsPath: string,
): void => {
  console.log(`Dataset eval results: ${resultsPath}`);
  console.log("case\tstatus\tfailed scores\tdelegations\tsubjective scores");
  for (const result of results) {
    console.log(
      `${result.caseId}\t${result.status}\t${failedScoreNames(result.scores).join(",") || "-"}\t${result.observed.delegationCount}\t${subjectiveScoreSummary(result.subjectiveJudge)}`,
    );
  }
  const passed = results.filter((result) =>
    allDatasetScoresPass(result.scores),
  ).length;
  console.log(`Dataset threshold: ${passed}/${results.length} cases passed`);
};

export type DatasetEvalOptions = {
  model?: LanguageModel;
  casesPath?: string;
  resultsDir?: string;
  resultsPath?: string;
  resume?: boolean;
  judgeModel?: LanguageModel;
  now?: Date;
};

export const runDatasetEvals = async (
  options: DatasetEvalOptions = {},
): Promise<{
  results: DatasetEvalResult[];
  resultsPath: string;
  passed: boolean;
}> => {
  const cases = loadDatasetCases(options.casesPath);
  const model = options.model ?? resolveAgentModel(loadAgentModelConfig());
  const timestamp = (options.now ?? new Date())
    .toISOString()
    .replace(/[:.]/g, "-");
  const resultsPath =
    options.resultsPath ??
    join(
      options.resultsDir ?? DEFAULT_RESULTS_DIR,
      `dataset-${timestamp}.jsonl`,
    );
  const previousResults = await prepareResultFile<DatasetEvalResult>(
    resultsPath,
    options.resume === true,
  );

  const agent = new ModelOrchestratorAgent(model);
  const results: DatasetEvalResult[] = [];
  for (const testCase of cases) {
    const previous = previousResults.get(testCase.id);
    if (
      previous?.status === "passed" &&
      (!options.judgeModel || previous.subjectiveJudge?.status === "reported")
    ) {
      results.push(previous);
      continue;
    }
    const result = await runCase(agent, testCase, options.judgeModel);
    results.push(result);
    await appendResult(resultsPath, result);
  }

  printReport(results, resultsPath);
  return {
    results,
    resultsPath,
    passed: passesDatasetSuiteThreshold(results),
  };
};

const main = async (): Promise<void> => {
  const judgeEnabled = process.argv.includes("--judge");
  const model = judgeEnabled
    ? resolveAgentModel(loadAgentModelConfig())
    : undefined;
  const result = await runDatasetEvals(
    model ? { model, judgeModel: model } : {},
  );
  if (!result.passed) process.exitCode = 1;
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
