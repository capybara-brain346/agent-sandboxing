export const githubSessionBranch = (sessionId: string): string =>
  `agent/${sessionId}`.replace(/[^A-Za-z0-9._/-]/g, "-");

export const sameGitBranch = (left: string | null, right: string): boolean =>
  left?.toLowerCase() === right.toLowerCase();
