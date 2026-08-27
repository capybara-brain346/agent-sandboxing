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
