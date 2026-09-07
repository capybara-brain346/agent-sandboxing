import { agentEvalCases } from "./cases";
import { agentEvalReportPath, writeEvalReport } from "./cases/harness/report";
import { resolveEvalModel, runAgentEval } from "./cases/harness/run-agent-eval";

const model = resolveEvalModel();

if (!model) {
  console.log("SKIP agent-service evals: missing OPENROUTER_API_KEY");
  process.exit(0);
}

console.log("agent-service evals");

let failed = 0;

for (const evalCase of agentEvalCases) {
  const result = await runAgentEval(evalCase, model);
  await writeEvalReport(result);
  if (result.passed) {
    console.log(`PASS ${result.name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${result.name}`);
    for (const failure of result.failures) console.log(`  ${failure}`);
  }
}

console.log(`${agentEvalCases.length - failed} passed, ${failed} failed`);
console.log(`report: ${agentEvalReportPath}`);

if (failed) process.exit(1);
