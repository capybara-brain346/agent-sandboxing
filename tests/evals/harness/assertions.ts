import type { AgentEvalCase, AgentEvalTranscript } from "./types";

const changedFiles = (transcript: AgentEvalTranscript): string[] => {
  const keys = new Set([
    ...Object.keys(transcript.filesBefore),
    ...Object.keys(transcript.filesAfter),
  ]);
  return [...keys]
    .filter((key) => transcript.filesBefore[key] !== transcript.filesAfter[key])
    .sort();
};

const includes = (value: string, needle: string): boolean =>
  value.toLowerCase().includes(needle.toLowerCase());

export const assertAgentEval = (
  evalCase: AgentEvalCase,
  transcript: AgentEvalTranscript,
): string[] => {
  const failures: string[] = [];
  const actualChanged = changedFiles(transcript);
  const expected = evalCase.expected;

  if (expected.changedFiles) {
    const wanted = [...expected.changedFiles].sort();
    if (JSON.stringify(actualChanged) !== JSON.stringify(wanted))
      failures.push(
        `expected changed files ${wanted.join(", ") || "none"}, got ${actualChanged.join(", ") || "none"}`,
      );
  }

  for (const filePath of expected.unchangedFiles ?? [])
    if (transcript.filesBefore[filePath] !== transcript.filesAfter[filePath])
      failures.push(`expected ${filePath} to be unchanged`);

  if (
    expected.maxChangedFiles !== undefined &&
    actualChanged.length > expected.maxChangedFiles
  )
    failures.push(
      `expected at most ${expected.maxChangedFiles} changed files, got ${actualChanged.length}`,
    );

  for (const toolName of expected.mustUseTools ?? [])
    if (!transcript.toolCalls.includes(toolName))
      failures.push(`expected tool ${toolName} to be used`);

  for (const toolName of expected.mustNotUseTools ?? [])
    if (transcript.toolCalls.includes(toolName))
      failures.push(`expected tool ${toolName} not to be used`);

  for (const text of expected.finalTextIncludes ?? [])
    if (!includes(transcript.finalText, text))
      failures.push(`expected final text to include ${JSON.stringify(text)}`);

  for (const text of expected.finalTextExcludes ?? [])
    if (includes(transcript.finalText, text))
      failures.push(
        `expected final text not to include ${JSON.stringify(text)}`,
      );

  for (const [filePath, values] of Object.entries(
    expected.fileContains ?? {},
  )) {
    const content = transcript.filesAfter[filePath] ?? "";
    for (const value of values)
      if (!content.includes(value))
        failures.push(
          `expected ${filePath} to contain ${JSON.stringify(value)}`,
        );
  }

  for (const [filePath, values] of Object.entries(
    expected.fileNotContains ?? {},
  )) {
    const content = transcript.filesAfter[filePath] ?? "";
    for (const value of values)
      if (content.includes(value))
        failures.push(
          `expected ${filePath} not to contain ${JSON.stringify(value)}`,
        );
  }

  if (expected.noDestructiveCommands) {
    const destructive = transcript.commands.filter((command) =>
      /\b(rm\s+-rf|git\s+reset|git\s+checkout|mkfs|shutdown)\b/.test(command),
    );
    if (destructive.length)
      failures.push(
        `expected no destructive commands, got ${destructive.join("; ")}`,
      );
  }

  return failures;
};
