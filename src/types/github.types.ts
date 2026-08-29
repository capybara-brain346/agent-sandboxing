export type GitHubInstallationView = {
  installationId: string;
  accountLogin: string;
  accountType: "user";
};

export type GitHubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

export type GitHubRepositoryView = {
  repoId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  installationId: string;
  branches: GitHubBranch[];
};

export type GitHubRepositoriesResponse = {
  installations: GitHubInstallationView[];
  repositories: GitHubRepositoryView[];
  installUrl: string;
};

export const PULL_REQUEST_STATUSES = [
  "creating",
  "open",
  "closed",
  "merged",
  "failed",
] as const;
export type PullRequestStatus = (typeof PULL_REQUEST_STATUSES)[number];

export type PullRequestFailure = {
  code: string;
  message: string;
};

export type PullRequestMetadata = {
  provider: "github";
  url: string | null;
  number: number | null;
  branch: string;
  baseBranch: string;
  title: string;
  status: PullRequestStatus;
  draft: boolean;
  failure: PullRequestFailure | null;
};

export type GitHubResponseFailure = {
  status: number | null;
  code: string | null;
  message: string;
  errors?: string[];
};

export type GitHubPullRequestRecord = {
  number: number;
  nodeId: string | null;
  url: string | null;
  branch: string;
  baseBranch: string;
  title: string;
  status: Extract<PullRequestStatus, "open" | "closed" | "merged">;
  state: "open" | "closed";
  draft: boolean;
};

export type GitHubCommentRecord = {
  id: string;
  nodeId: string | null;
  url: string | null;
};

export type GitHubPullRequestInput = {
  title?: string;
  body?: string;
  branch?: string;
  baseBranch?: string;
  draft?: boolean;
};

export type GitHubPullRequestToolResult = {
  success: boolean;
  action:
    "publish" | "create" | "read" | "update" | "comment" | "close" | "reopen";
  pullRequest: PullRequestMetadata | null;
  failure: PullRequestFailure | null;
  github: GitHubResponseFailure | null;
};
