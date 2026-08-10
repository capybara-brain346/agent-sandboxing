export const workspaceRoot = "/workspace/repo";

export const isWorkspacePath = (value: string): boolean =>
  value === workspaceRoot || value.startsWith(`${workspaceRoot}/`);
