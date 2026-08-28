import { randomUUID } from "node:crypto";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import type {
  GitHubBranch,
  GitHubCommentRecord,
  GitHubInstallationView,
  GitHubPullRequestInput,
  GitHubPullRequestRecord,
  GitHubPullRequestToolResult,
  GitHubRepositoriesResponse,
  GitHubRepositoryView,
  GitHubResponseFailure,
  PullRequestMetadata,
} from "../../types/github.types";
import type { PublicEvent } from "../../types/event.types";
import { decryptToken } from "../auth/token-crypto";
import type { EventStore } from "../events/event-store";

export type GitHubRepositoryRecord = {
  id: string;
  ownerId: string;
  ownerLogin: string;
  ownerType: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type GitHubBranchRecord = GitHubBranch;

export type GitHubInstallationRecord = {
  accountId: string;
  accountLogin: string;
  accountType: string;
};

export type GitHubAppInstallationRecord = GitHubInstallationRecord & {
  installationId: string;
};

export type GitHubSessionRepository = {
  owner: string;
  name: string;
  installationId: string;
  baseBranch: string | null;
  defaultBranch: string | null;
};

export type GitHubRepositorySelection = {
  repoId?: string | null | undefined;
  owner?: string | null | undefined;
  name?: string | null | undefined;
  installationId?: string | null | undefined;
  baseBranch?: string | null | undefined;
  baseSha?: string | null | undefined;
};

export type GitHubPullRequestActionInput = GitHubPullRequestInput & {
  action: "create" | "update" | "comment" | "close" | "reopen";
  comment?: string;
  number?: number;
  supersedeExisting?: boolean;
};

type PullRequestRow = {
  id: string;
  sessionId: string;
  runId: string | null;
  provider: string;
  owner: string;
  repo: string;
  installationId: string;
  number: number | null;
  nodeId: string | null;
  url: string | null;
  branch: string;
  baseBranch: string;
  title: string;
  status: string;
  draft: boolean;
  isCurrent: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  openedAt: Date | null;
  closedAt: Date | null;
};

export type GitHubApi = {
  listAppInstallations(): Promise<GitHubAppInstallationRecord[]>;
  listOAuthRepositories(accessToken: string): Promise<GitHubRepositoryRecord[]>;
  getInstallation(installationId: string): Promise<GitHubInstallationRecord>;
  createInstallationToken(installationId: string): Promise<string>;
  listInstallationRepositories(
    installationId: string,
  ): Promise<GitHubRepositoryRecord[]>;
  listBranches(
    installationId: string,
    owner: string,
    name: string,
  ): Promise<GitHubBranchRecord[]>;
  createPullRequest?: (
    installationId: string,
    owner: string,
    name: string,
    input: Required<
      Pick<GitHubPullRequestInput, "title" | "branch" | "baseBranch">
    > &
      Pick<GitHubPullRequestInput, "body" | "draft">,
  ) => Promise<GitHubPullRequestRecord>;
  updatePullRequest?: (
    installationId: string,
    owner: string,
    name: string,
    number: number,
    input: GitHubPullRequestInput & { state?: "open" | "closed" },
  ) => Promise<GitHubPullRequestRecord>;
  readyForReview?: (
    installationId: string,
    owner: string,
    name: string,
    number: number,
  ) => Promise<GitHubPullRequestRecord>;
  commentPullRequest?: (
    installationId: string,
    owner: string,
    name: string,
    number: number,
    body: string,
  ) => Promise<GitHubCommentRecord>;
};

type InstallationOctokit = {
  request: (
    route: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown }>;
};

class OctokitGitHubApi implements GitHubApi {
  private readonly app: App;

  constructor(config: Config) {
    this.app = new App({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_APP_PRIVATE_KEY,
    });
  }

  async listAppInstallations(): Promise<GitHubAppInstallationRecord[]> {
    const installations: GitHubAppInstallationRecord[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.app.octokit.request(
        "GET /app/installations",
        {
          per_page: 100,
          page,
        },
      );
      const data = response.data as Array<{
        id: number;
        account: { id: number; login: string; type: string } | null;
      }>;
      installations.push(
        ...data.flatMap((installation) =>
          installation.account
            ? [
                {
                  installationId: String(installation.id),
                  accountId: String(installation.account.id),
                  accountLogin: installation.account.login,
                  accountType: installation.account.type,
                },
              ]
            : [],
        ),
      );
      if (data.length < 100) return installations;
    }
  }

  async listOAuthRepositories(
    accessToken: string,
  ): Promise<GitHubRepositoryRecord[]> {
    const octokit = new Octokit({ auth: accessToken });
    const repositories = await octokit.paginate(
      octokit.rest.repos.listForAuthenticatedUser,
      { affiliation: "owner", per_page: 100, visibility: "all" },
    );
    return repositories.map((repository) => ({
      id: String(repository.id),
      ownerId: String(repository.owner.id),
      ownerLogin: repository.owner.login,
      ownerType: repository.owner.type,
      name: repository.name,
      fullName: repository.full_name,
      private: repository.private,
      defaultBranch: repository.default_branch,
    }));
  }

  async getInstallation(
    installationId: string,
  ): Promise<GitHubInstallationRecord> {
    const response = await this.app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: Number(installationId) },
    );
    const data = response.data as {
      account: { id: number; login: string; type: string };
    };
    return {
      accountId: String(data.account.id),
      accountLogin: data.account.login,
      accountType: data.account.type,
    };
  }

  async createInstallationToken(installationId: string): Promise<string> {
    const octokit = await this.app.getInstallationOctokit(
      Number(installationId),
    );
    const authentication = (await octokit.auth({
      type: "installation",
    })) as { token?: unknown };
    if (typeof authentication.token !== "string" || !authentication.token)
      throw new Error("GitHub installation token was missing");
    return authentication.token;
  }

  async listInstallationRepositories(
    installationId: string,
  ): Promise<GitHubRepositoryRecord[]> {
    const repositories: GitHubRepositoryRecord[] = [];
    for await (const item of this.app.eachRepository.iterator({
      installationId: Number(installationId),
    })) {
      repositories.push({
        id: String(item.repository.id),
        ownerId: String(item.repository.owner.id),
        ownerLogin: item.repository.owner.login,
        ownerType: item.repository.owner.type,
        name: item.repository.name,
        fullName: item.repository.full_name,
        private: item.repository.private,
        defaultBranch: item.repository.default_branch,
      });
    }
    return repositories;
  }

  async listBranches(
    installationId: string,
    owner: string,
    name: string,
  ): Promise<GitHubBranchRecord[]> {
    const octokit = (await this.app.getInstallationOctokit(
      Number(installationId),
    )) as unknown as InstallationOctokit;
    const branches: GitHubBranchRecord[] = [];
    for (let page = 1; ; page += 1) {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/branches",
        {
          owner,
          repo: name,
          per_page: 100,
          page,
        },
      );
      const data = response.data as Array<{
        name: string;
        commit: { sha: string };
        protected: boolean;
      }>;
      branches.push(
        ...data.map((branch) => ({
          name: branch.name,
          sha: branch.commit.sha,
          protected: branch.protected,
        })),
      );
      if (data.length < 100) return branches;
    }
  }

  private async installationRequest(
    installationId: string,
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    const octokit = (await this.app.getInstallationOctokit(
      Number(installationId),
    )) as unknown as InstallationOctokit;
    return (await octokit.request(route, parameters)).data;
  }

  async createPullRequest(
    installationId: string,
    owner: string,
    name: string,
    input: Required<
      Pick<GitHubPullRequestInput, "title" | "branch" | "baseBranch">
    > &
      Pick<GitHubPullRequestInput, "body" | "draft">,
  ): Promise<GitHubPullRequestRecord> {
    const data = (await this.installationRequest(
      installationId,
      "POST /repos/{owner}/{repo}/pulls",
      {
        owner,
        repo: name,
        title: input.title,
        head: input.branch,
        base: input.baseBranch,
        body: input.body,
        draft: input.draft,
      },
    )) as Record<string, unknown>;
    return pullRequestRecord(data, input);
  }

  async updatePullRequest(
    installationId: string,
    owner: string,
    name: string,
    number: number,
    input: GitHubPullRequestInput & { state?: "open" | "closed" },
  ): Promise<GitHubPullRequestRecord> {
    const data = (await this.installationRequest(
      installationId,
      "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo: name,
        pull_number: number,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.baseBranch !== undefined ? { base: input.baseBranch } : {}),
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
      },
    )) as Record<string, unknown>;
    return pullRequestRecord(data, input, number);
  }

  async readyForReview(
    installationId: string,
    owner: string,
    name: string,
    number: number,
  ): Promise<GitHubPullRequestRecord> {
    const data = (await this.installationRequest(
      installationId,
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/ready_for_review",
      { owner, repo: name, pull_number: number },
    )) as Record<string, unknown>;
    return pullRequestRecord(data, {}, number);
  }

  async commentPullRequest(
    installationId: string,
    owner: string,
    name: string,
    number: number,
    body: string,
  ): Promise<GitHubCommentRecord> {
    const data = (await this.installationRequest(
      installationId,
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      { owner, repo: name, issue_number: number, body },
    )) as Record<string, unknown>;
    return {
      id: String(data.id ?? ""),
      nodeId: typeof data.node_id === "string" ? data.node_id : null,
      url: typeof data.html_url === "string" ? data.html_url : null,
    };
  }
}

const pullRequestRecord = (
  data: Record<string, unknown>,
  input: Partial<GitHubPullRequestInput>,
  numberFallback?: number,
): GitHubPullRequestRecord => {
  const number = typeof data.number === "number" ? data.number : numberFallback;
  if (number === undefined)
    throw new Error("GitHub pull request number was missing");
  const head = data.head as Record<string, unknown> | undefined;
  const base = data.base as Record<string, unknown> | undefined;
  return {
    number,
    nodeId: typeof data.node_id === "string" ? data.node_id : null,
    url: typeof data.html_url === "string" ? data.html_url : null,
    branch: typeof head?.ref === "string" ? head.ref : (input.branch ?? ""),
    baseBranch:
      typeof base?.ref === "string" ? base.ref : (input.baseBranch ?? ""),
    title: typeof data.title === "string" ? data.title : (input.title ?? ""),
    state: data.state === "closed" ? "closed" : "open",
    draft: typeof data.draft === "boolean" ? data.draft : (input.draft ?? true),
  };
};

const bounded = (value: string, limit = 300): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value;

const githubFailure = (error: unknown): GitHubResponseFailure => {
  const candidate = error as {
    code?: unknown;
    response?: {
      status?: unknown;
      data?: { message?: unknown; code?: unknown };
    };
    message?: unknown;
  };
  const response = candidate.response;
  return {
    status:
      typeof response?.status === "number" && Number.isInteger(response.status)
        ? response.status
        : null,
    code:
      typeof response?.data?.code === "string"
        ? bounded(response.data.code)
        : typeof candidate.code === "string"
          ? bounded(candidate.code)
          : null,
    message:
      typeof response?.data?.message === "string"
        ? bounded(response.data.message)
        : "GitHub API request failed",
  };
};

const operationFailure = (
  action: GitHubPullRequestToolResult["action"],
  code: string,
  message: string,
  pullRequest: PullRequestMetadata | null = null,
  github: GitHubResponseFailure | null = null,
): GitHubPullRequestToolResult => ({
  success: false,
  action,
  pullRequest,
  failure: { code, message },
  github,
});

const operationSuccess = (
  action: Exclude<GitHubPullRequestToolResult["action"], "push">,
  pullRequest: PullRequestMetadata,
  github: GitHubResponseFailure | null = null,
): GitHubPullRequestToolResult => ({
  success: true,
  action,
  pullRequest,
  failure: null,
  github,
});

const pullRequestMetadata = (row: PullRequestRow): PullRequestMetadata => ({
  provider: "github",
  url: row.url,
  number: row.number,
  branch: row.branch,
  baseBranch: row.baseBranch,
  title: row.title,
  status: row.status as PullRequestMetadata["status"],
  draft: row.draft,
  failure: row.failureCode
    ? {
        code: row.failureCode,
        message: row.failureMessage ?? "Pull request operation failed",
      }
    : null,
});

export class GitHubService {
  private readonly api: GitHubApi;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Config,
    api?: GitHubApi,
    private readonly events?: Pick<
      EventStore,
      "appendRunEvent" | "appendRunEventInTransaction"
    >,
    private readonly publish: (event: PublicEvent) => void = () => undefined,
  ) {
    this.api = api ?? new OctokitGitHubApi(config);
  }

  installUrl(): string {
    return this.config.GITHUB_APP_INSTALL_URL;
  }

  async createInstallationToken(installationId: string): Promise<string> {
    if (!/^\d+$/.test(installationId))
      throw new ServiceError(
        "github_installation_token_failed",
        "GitHub installation token could not be created",
        502,
      );
    try {
      const token = await this.api.createInstallationToken(installationId);
      if (typeof token !== "string" || !token)
        throw new Error("GitHub installation token was missing");
      return token;
    } catch {
      throw new ServiceError(
        "github_installation_token_failed",
        "GitHub installation token could not be created",
        502,
      );
    }
  }

  async sessionRepository(sessionId: string): Promise<GitHubSessionRepository> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: {
        repoSource: true,
        repoOwner: true,
        repoName: true,
        repoInstallationId: true,
        repoBaseBranch: true,
        repoDefaultBranch: true,
      },
    });
    if (!session || session.repoSource !== "github")
      throw new ServiceError(
        "github_session_required",
        "This capability requires a GitHub-backed session",
        422,
      );
    if (
      !session.repoOwner ||
      !session.repoName ||
      !session.repoInstallationId ||
      !/^\d+$/.test(session.repoInstallationId)
    )
      throw new ServiceError(
        "github_repository_metadata_missing",
        "GitHub repository metadata is incomplete",
        400,
      );
    return {
      owner: session.repoOwner,
      name: session.repoName,
      installationId: session.repoInstallationId,
      baseBranch: session.repoBaseBranch,
      defaultBranch: session.repoDefaultBranch,
    };
  }

  async validateRepository(
    userId: string,
    selection: GitHubRepositorySelection,
  ): Promise<void> {
    const visible = await this.repositories(userId);
    const repository = visible.repositories.find(
      (candidate) =>
        candidate.installationId === selection.installationId &&
        (selection.repoId === undefined ||
          selection.repoId === null ||
          candidate.repoId === selection.repoId) &&
        candidate.owner.toLowerCase() === selection.owner?.toLowerCase() &&
        candidate.name.toLowerCase() === selection.name?.toLowerCase(),
    );
    if (!repository)
      throw new ServiceError(
        "github_repository_not_found",
        "Repository was not found",
        404,
      );
    if (selection.baseBranch || selection.baseSha) {
      const baseBranch = selection.baseBranch ?? repository.defaultBranch;
      const branch = (await this.branches(userId, repository.repoId)).find(
        (candidate) => candidate.name === baseBranch,
      );
      if (
        !branch ||
        (selection.baseSha !== undefined &&
          selection.baseSha !== null &&
          branch.sha !== selection.baseSha)
      )
        throw new ServiceError(
          "github_branch_not_found",
          "Branch was not found",
          404,
        );
    }
  }

  async currentPullRequest(
    sessionId: string,
  ): Promise<PullRequestMetadata | null> {
    const current = await this.prisma.pullRequest.findFirst({
      where: { sessionId, isCurrent: true },
      orderBy: { createdAt: "desc" },
    });
    const row =
      current ??
      (await this.prisma.pullRequest.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
      }));
    return row ? pullRequestMetadata(row) : null;
  }

  async recordGitPushEvent(
    sessionId: string,
    runId: string,
    branch: string,
    failure?: { code: string; message: string },
  ): Promise<void> {
    if (!this.events?.appendRunEvent) return;
    const event = await this.events.appendRunEvent({
      sessionId,
      runId,
      type: failure ? "pull_request_failed" : "pull_request_branch_pushed",
      producerService: "github",
      producerId: runId,
      correlationId: randomUUID(),
      domain: "pull_request",
      payload: failure ? { action: "push", branch, failure } : { branch },
    });
    this.publish(event);
  }

  async pullRequest(
    sessionId: string,
    runId: string,
    input: GitHubPullRequestActionInput,
  ): Promise<GitHubPullRequestToolResult> {
    const repository = await this.sessionRepository(sessionId);
    if (input.action === "create")
      return this.createPullRequest(sessionId, runId, repository, input);

    const row = input.number
      ? await this.prisma.pullRequest.findFirst({
          where: { sessionId, number: input.number },
          orderBy: { createdAt: "desc" },
        })
      : await this.prisma.pullRequest.findFirst({
          where: { sessionId, isCurrent: true },
          orderBy: { createdAt: "desc" },
        });
    if (!row || row.number === null)
      return operationFailure(
        input.action,
        "pull_request_not_found",
        "No pull request was found for this session",
      );

    if (input.action === "comment") {
      if (!input.comment?.trim())
        return operationFailure(
          input.action,
          "invalid_pull_request_comment",
          "A pull request comment is required",
        );
      if (!this.api.commentPullRequest) {
        const next = await this.persistPullRequestFailure(
          sessionId,
          runId,
          input.action,
          row,
          "github_api_unavailable",
          "GitHub pull request API is unavailable",
          null,
        );
        return operationFailure(
          input.action,
          "github_api_unavailable",
          "GitHub pull request API is unavailable",
          pullRequestMetadata(next),
        );
      }
      try {
        await this.api.commentPullRequest(
          row.installationId,
          row.owner,
          row.repo,
          row.number,
          input.comment,
        );
      } catch (error) {
        const github = githubFailure(error);
        const next = await this.persistPullRequestFailure(
          sessionId,
          runId,
          input.action,
          row,
          "github_pull_request_failed",
          "GitHub pull request operation failed",
          github,
        );
        return operationFailure(
          input.action,
          "github_pull_request_failed",
          "GitHub pull request operation failed",
          pullRequestMetadata(next),
          github,
        );
      }
      const next = await this.persistPullRequestComment(sessionId, runId, row);
      return operationSuccess(input.action, pullRequestMetadata(next));
    }

    if (!this.api.updatePullRequest) {
      const next = await this.persistPullRequestFailure(
        sessionId,
        runId,
        input.action,
        row,
        "github_api_unavailable",
        "GitHub pull request API is unavailable",
        null,
      );
      return operationFailure(
        input.action,
        "github_api_unavailable",
        "GitHub pull request API is unavailable",
        pullRequestMetadata(next),
      );
    }

    let updated: GitHubPullRequestRecord;
    try {
      updated = await this.api.updatePullRequest(
        row.installationId,
        row.owner,
        row.repo,
        row.number,
        input.action === "close"
          ? { state: "closed" }
          : input.action === "reopen"
            ? { state: "open" }
            : {
                ...(input.title !== undefined ? { title: input.title } : {}),
                ...(input.body !== undefined ? { body: input.body } : {}),
                ...(input.baseBranch !== undefined
                  ? { baseBranch: input.baseBranch }
                  : {}),
                ...(input.draft !== undefined && (input.draft || !row.draft)
                  ? { draft: input.draft }
                  : {}),
              },
      );
      if (input.action === "update" && input.draft === false && row.draft) {
        if (!this.api.readyForReview) {
          const next = await this.persistPullRequestFailure(
            sessionId,
            runId,
            input.action,
            row,
            "github_draft_transition_unsupported",
            "GitHub does not support the requested draft transition",
            null,
          );
          return operationFailure(
            input.action,
            "github_draft_transition_unsupported",
            "GitHub does not support the requested draft transition",
            pullRequestMetadata(next),
          );
        }
        updated = await this.api.readyForReview(
          row.installationId,
          row.owner,
          row.repo,
          row.number,
        );
      }
    } catch (error) {
      const github = githubFailure(error);
      const next = await this.persistPullRequestFailure(
        sessionId,
        runId,
        input.action,
        row,
        "github_pull_request_failed",
        "GitHub pull request operation failed",
        github,
      );
      return operationFailure(
        input.action,
        "github_pull_request_failed",
        "GitHub pull request operation failed",
        pullRequestMetadata(next),
        github,
      );
    }
    const status =
      input.action === "close"
        ? "closed"
        : input.action === "reopen"
          ? "open"
          : updated.state;
    const next = await this.persistPullRequestUpdate(
      sessionId,
      runId,
      row,
      {
        number: updated.number,
        nodeId: updated.nodeId ?? row.nodeId,
        url: updated.url ?? row.url,
        branch: updated.branch || row.branch,
        baseBranch: updated.baseBranch || row.baseBranch,
        title: updated.title || input.title || row.title,
        status,
        draft: updated.draft,
        failureCode: null,
        failureMessage: null,
        closedAt: status === "closed" ? new Date() : null,
      },
      input.action === "close"
        ? "pull_request_closed"
        : input.action === "reopen"
          ? "pull_request_reopened"
          : "pull_request_updated",
    );
    return operationSuccess(input.action, pullRequestMetadata(next));
  }

  private async createPullRequest(
    sessionId: string,
    runId: string,
    repository: GitHubSessionRepository,
    input: GitHubPullRequestActionInput,
  ): Promise<GitHubPullRequestToolResult> {
    const baseBranch =
      input.baseBranch ?? repository.baseBranch ?? repository.defaultBranch;
    if (!baseBranch)
      return operationFailure(
        "create",
        "github_base_branch_missing",
        "A GitHub base branch is required",
      );
    const branch = input.branch;
    const title = input.title;
    if (!branch || !title)
      return operationFailure(
        "create",
        "invalid_pull_request_input",
        "A branch and title are required to create a pull request",
      );

    const current = await this.prisma.pullRequest.findFirst({
      where: { sessionId, isCurrent: true },
      orderBy: { createdAt: "desc" },
    });
    if (current && !input.supersedeExisting)
      return operationFailure(
        "create",
        "pull_request_already_exists",
        "This session already has a current pull request",
        pullRequestMetadata(current),
      );

    const creating = await this.prisma.$transaction(async (tx) => {
      if (input.supersedeExisting)
        await tx.pullRequest.updateMany({
          where: { sessionId, isCurrent: true },
          data: { isCurrent: false },
        });
      const row = await tx.pullRequest.create({
        data: {
          id: `pr_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
          sessionId,
          runId,
          provider: "github",
          owner: repository.owner,
          repo: repository.name,
          installationId: repository.installationId,
          branch,
          baseBranch,
          title,
          status: "creating",
          draft: input.draft !== false,
          isCurrent: true,
        },
      });
      const event = await this.appendRunEventInTransaction(
        tx,
        sessionId,
        runId,
        "pull_request_creation_started",
        row,
        { pull_request: pullRequestMetadata(row) },
      );
      return { row, event };
    });
    if (creating.event) this.publish(creating.event);

    if (!this.api.createPullRequest)
      return this.failCreatingPullRequest(
        sessionId,
        runId,
        creating.row,
        "github_api_unavailable",
        "GitHub pull request API is unavailable",
      );
    let created: GitHubPullRequestRecord;
    try {
      created = await this.api.createPullRequest(
        repository.installationId,
        repository.owner,
        repository.name,
        {
          title,
          branch,
          baseBranch,
          ...(input.body !== undefined ? { body: input.body } : {}),
          draft: input.draft !== false,
        },
      );
    } catch (error) {
      const github = githubFailure(error);
      return this.failCreatingPullRequest(
        sessionId,
        runId,
        creating.row,
        "github_pull_request_failed",
        "GitHub pull request creation failed",
        github,
      );
    }
    const next = await this.persistPullRequestUpdate(
      sessionId,
      runId,
      creating.row,
      {
        number: created.number,
        nodeId: created.nodeId,
        url: created.url,
        branch: created.branch || branch,
        baseBranch: created.baseBranch || baseBranch,
        title: created.title || title,
        status: "open",
        draft: created.draft,
        failureCode: null,
        failureMessage: null,
        closedAt: null,
        openedAt: new Date(),
      },
      "pull_request_created",
    );
    return operationSuccess("create", pullRequestMetadata(next));
  }

  private async failCreatingPullRequest(
    sessionId: string,
    runId: string,
    row: PullRequestRow,
    code: string,
    message: string,
    github: GitHubResponseFailure | null = null,
  ): Promise<GitHubPullRequestToolResult> {
    const next = await this.persistPullRequestUpdate(
      sessionId,
      runId,
      row,
      {
        number: null,
        nodeId: null,
        url: null,
        branch: row.branch,
        baseBranch: row.baseBranch,
        title: row.title,
        status: "failed",
        draft: row.draft,
        isCurrent: false,
        failureCode: code,
        failureMessage: message,
        closedAt: null,
      },
      "pull_request_failed",
    );
    return operationFailure(
      "create",
      code,
      message,
      pullRequestMetadata(next),
      github,
    );
  }

  private async persistPullRequestUpdate(
    sessionId: string,
    runId: string,
    row: PullRequestRow,
    data: {
      number: number | null;
      nodeId: string | null;
      url: string | null;
      branch: string;
      baseBranch: string;
      title: string;
      status: "creating" | "open" | "closed" | "failed";
      draft: boolean;
      isCurrent?: boolean;
      failureCode: string | null;
      failureMessage: string | null;
      closedAt: Date | null;
      openedAt?: Date;
    },
    eventType:
      | "pull_request_created"
      | "pull_request_updated"
      | "pull_request_closed"
      | "pull_request_reopened"
      | "pull_request_failed",
  ): Promise<PullRequestRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      const next = await tx.pullRequest.update({
        where: { id: row.id },
        data,
      });
      const event = await this.appendRunEventInTransaction(
        tx,
        sessionId,
        runId,
        eventType,
        next,
        { pull_request: pullRequestMetadata(next) },
      );
      return { next, event };
    });
    if (result.event) this.publish(result.event);
    return result.next;
  }

  private async appendRunEventInTransaction(
    tx: Parameters<NonNullable<EventStore["appendRunEventInTransaction"]>>[0],
    sessionId: string,
    runId: string,
    type:
      | "pull_request_creation_started"
      | "pull_request_created"
      | "pull_request_updated"
      | "pull_request_closed"
      | "pull_request_reopened"
      | "pull_request_commented"
      | "pull_request_failed",
    row: PullRequestRow,
    payload: Record<string, unknown>,
  ): Promise<PublicEvent | null> {
    if (!this.events?.appendRunEventInTransaction) return null;
    return this.events.appendRunEventInTransaction(tx, {
      sessionId,
      runId,
      type,
      producerService: "github",
      producerId: row.id,
      correlationId: randomUUID(),
      domain: "pull_request",
      payload,
    });
  }

  private async persistPullRequestComment(
    sessionId: string,
    runId: string,
    row: PullRequestRow,
  ): Promise<PullRequestRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      const next = row.failureCode
        ? await tx.pullRequest.update({
            where: { id: row.id },
            data: { failureCode: null, failureMessage: null },
          })
        : row;
      const event = await this.appendRunEventInTransaction(
        tx,
        sessionId,
        runId,
        "pull_request_commented",
        next,
        {},
      );
      return { next, event };
    });
    if (result.event) this.publish(result.event);
    return result.next;
  }

  private async persistPullRequestFailure(
    sessionId: string,
    runId: string,
    action: GitHubPullRequestActionInput["action"],
    row: PullRequestRow,
    code: string,
    message: string,
    github: GitHubResponseFailure | null,
  ): Promise<PullRequestRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      const next = await tx.pullRequest.update({
        where: { id: row.id },
        data: { failureCode: code, failureMessage: message },
      });
      const event = await this.appendRunEventInTransaction(
        tx,
        sessionId,
        runId,
        "pull_request_failed",
        next,
        {
          action,
          pull_request: pullRequestMetadata(next),
          failure: { code, message },
          github,
        },
      );
      return { next, event };
    });
    if (result.event) this.publish(result.event);
    return result.next;
  }

  async saveInstallation(
    userId: string,
    installationId: string,
  ): Promise<GitHubInstallationView> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { githubUserId: true },
      });
      if (!user)
        throw new ServiceError(
          "auth_invalid",
          "Authentication is invalid",
          401,
        );
      const installation = await this.api.getInstallation(installationId);
      if (
        installation.accountType.toLowerCase() !== "user" ||
        installation.accountId !== user.githubUserId
      )
        throw new ServiceError(
          "github_installation_not_allowed",
          "This GitHub App installation is not available for the account",
          403,
        );
      const saved = await this.prisma.gitHubInstallation.upsert({
        where: { userId_installationId: { userId, installationId } },
        create: {
          userId,
          installationId,
          accountLogin: installation.accountLogin,
          accountType: "User",
        },
        update: {
          accountLogin: installation.accountLogin,
          accountType: "User",
        },
      });
      return {
        installationId: saved.installationId,
        accountLogin: saved.accountLogin,
        accountType: "user",
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "github_installation_failed",
        "GitHub App installation could not be connected",
        502,
      );
    }
  }

  private async installationsForUser(
    userId: string,
    githubUserId: string,
  ): Promise<
    Array<{ installationId: string; accountLogin: string; accountType: string }>
  > {
    const saved = await this.prisma.gitHubInstallation.findMany({
      where: { userId },
      orderBy: { accountLogin: "asc" },
      select: {
        installationId: true,
        accountLogin: true,
        accountType: true,
      },
    });
    const installations = saved.filter(
      (installation) => installation.accountType.toLowerCase() === "user",
    );
    const known = new Set(
      installations.map((installation) => installation.installationId),
    );
    for (const installation of await this.api.listAppInstallations()) {
      if (
        installation.accountType.toLowerCase() !== "user" ||
        installation.accountId !== githubUserId ||
        known.has(installation.installationId)
      )
        continue;
      const next = await this.prisma.gitHubInstallation.upsert({
        where: {
          userId_installationId: {
            userId,
            installationId: installation.installationId,
          },
        },
        create: {
          userId,
          installationId: installation.installationId,
          accountLogin: installation.accountLogin,
          accountType: "User",
        },
        update: {
          accountLogin: installation.accountLogin,
          accountType: "User",
        },
        select: {
          installationId: true,
          accountLogin: true,
          accountType: true,
        },
      });
      known.add(next.installationId);
      installations.push(next);
    }
    return installations.sort((left, right) =>
      left.accountLogin.localeCompare(right.accountLogin),
    );
  }

  async repositories(userId: string): Promise<GitHubRepositoriesResponse> {
    try {
      const [user, token] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { githubUserId: true },
        }),
        this.prisma.gitHubOAuthToken.findUnique({
          where: { userId },
          select: {
            accessTokenCiphertext: true,
            accessTokenIv: true,
            accessTokenTag: true,
          },
        }),
      ]);
      if (!user || !token)
        throw new ServiceError(
          "github_reconnect_required",
          "Reconnect GitHub to refresh repository access",
          401,
        );
      const installations = await this.installationsForUser(
        userId,
        user.githubUserId,
      );
      const accessToken = decryptToken(
        {
          ciphertext: token.accessTokenCiphertext,
          iv: token.accessTokenIv,
          tag: token.accessTokenTag,
        },
        this.config.AUTH_TOKEN_ENCRYPTION_KEY,
      );
      const oauthRepositories = (
        await this.api.listOAuthRepositories(accessToken)
      ).filter(
        (repository) =>
          repository.ownerType.toLowerCase() === "user" &&
          repository.ownerId === user.githubUserId,
      );
      const visible = new Map(
        oauthRepositories.map((repository) => [repository.id, repository]),
      );
      const repositories = new Map<string, GitHubRepositoryView>();
      for (const installation of installations) {
        if (installation.accountType.toLowerCase() !== "user") continue;
        const installed = await this.api.listInstallationRepositories(
          installation.installationId,
        );
        for (const repository of installed) {
          const oauthRepository = visible.get(repository.id);
          if (!oauthRepository || repositories.has(repository.id)) continue;
          repositories.set(repository.id, {
            repoId: repository.id,
            owner: repository.ownerLogin,
            name: repository.name,
            fullName: repository.fullName,
            private: oauthRepository.private,
            defaultBranch: repository.defaultBranch,
            installationId: installation.installationId,
            branches: [],
          });
        }
      }
      return {
        installations: installations.map((installation) => ({
          installationId: installation.installationId,
          accountLogin: installation.accountLogin,
          accountType: "user" as const,
        })),
        repositories: [...repositories.values()].sort((left, right) =>
          left.fullName.localeCompare(right.fullName),
        ),
        installUrl: this.installUrl(),
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "github_reconnect_required",
        "Reconnect GitHub to refresh repository access",
        401,
      );
    }
  }

  async branches(userId: string, repoId: string): Promise<GitHubBranch[]> {
    try {
      const [user, token] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { githubUserId: true },
        }),
        this.prisma.gitHubOAuthToken.findUnique({
          where: { userId },
          select: {
            accessTokenCiphertext: true,
            accessTokenIv: true,
            accessTokenTag: true,
          },
        }),
      ]);
      if (!user || !token)
        throw new ServiceError(
          "github_reconnect_required",
          "Reconnect GitHub to refresh repository access",
          401,
        );
      const installations = await this.installationsForUser(
        userId,
        user.githubUserId,
      );
      const accessToken = decryptToken(
        {
          ciphertext: token.accessTokenCiphertext,
          iv: token.accessTokenIv,
          tag: token.accessTokenTag,
        },
        this.config.AUTH_TOKEN_ENCRYPTION_KEY,
      );
      const visible = new Set(
        (await this.api.listOAuthRepositories(accessToken))
          .filter(
            (repository) =>
              repository.ownerType.toLowerCase() === "user" &&
              repository.ownerId === user.githubUserId,
          )
          .map((repository) => repository.id),
      );
      for (const installation of installations) {
        const installed = await this.api.listInstallationRepositories(
          installation.installationId,
        );
        const repository = installed.find(
          (candidate) => candidate.id === repoId && visible.has(candidate.id),
        );
        if (repository)
          return this.api.listBranches(
            installation.installationId,
            repository.ownerLogin,
            repository.name,
          );
      }
      throw new ServiceError(
        "github_repository_not_found",
        "Repository was not found",
        404,
      );
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "github_reconnect_required",
        "Reconnect GitHub to refresh repository access",
        401,
      );
    }
  }
}

export { OctokitGitHubApi };
