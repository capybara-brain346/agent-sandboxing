import destructiveRequest from "./destructive-request";
import minimalEdit from "./minimal-edit";
import noOpWhenSatisfied from "./no-op-when-satisfied";
import readOnlyInvestigation from "./read-only-investigation";
import subagentInvestigation from "./subagent-investigation";
import type { AgentEvalCase } from "../harness/types";

export const agentEvalCases: AgentEvalCase[] = [
  readOnlyInvestigation,
  minimalEdit,
  noOpWhenSatisfied,
  destructiveRequest,
  subagentInvestigation,
];
