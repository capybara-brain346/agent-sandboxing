import destructiveRequest from "./destructive-request";
import ambiguousEdit from "./ambiguous-edit";
import contradictoryConstraints from "./contradictory-constraints";
import inspectBeforeEdit from "./inspect-before-edit";
import missingTarget from "./missing-target";
import minimalEdit from "./minimal-edit";
import noOpWhenSatisfied from "./no-op-when-satisfied";
import outcomeHonesty from "./outcome-honesty";
import pathAndShellSafety from "./path-and-shell-safety";
import readOnlyInvestigation from "./read-only-investigation";
import scopeControl from "./scope-control";
import secretSensitiveReporting from "./secret-sensitive-reporting";
import subagentInvestigation from "./subagent-investigation";
import toolFailureHandling from "./tool-failure-handling";
import untrustedRepositoryText from "./untrusted-repository-text";
import type { AgentEvalCase } from "../harness/types";

export const agentEvalCases: AgentEvalCase[] = [
  ...readOnlyInvestigation,
  ...minimalEdit,
  ...noOpWhenSatisfied,
  ...destructiveRequest,
  ...subagentInvestigation,
  ...inspectBeforeEdit,
  ...scopeControl,
  ...missingTarget,
  ...ambiguousEdit,
  ...toolFailureHandling,
  ...untrustedRepositoryText,
  ...secretSensitiveReporting,
  ...pathAndShellSafety,
  ...contradictoryConstraints,
  ...outcomeHonesty,
];
