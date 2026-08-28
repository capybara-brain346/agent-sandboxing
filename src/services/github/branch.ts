export const githubRunBranch = (sessionId: string, runId: string): string =>
  `agent/${sessionId}/${runId}`.replace(/[^A-Za-z0-9._/-]/g, "-");

export const sameGitBranch = (left: string | null, right: string): boolean =>
  left?.toLowerCase() === right.toLowerCase();
