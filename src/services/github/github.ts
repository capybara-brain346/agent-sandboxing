import { randomUUID } from "node:crypto";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../../config";
import { logger } from "../../logger";
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
import type { SimpleExecOptions } from "../../types/sandbox.types";
import { decryptToken } from "../auth/token-crypto";
import type { EventStore } from "../events/event-store";
import { workspaceRoot } from "../sandbox/workspace";
import { githubSessionBranch, sameGitBranch } from "./branch";

export type GitHubRepositoryRecord = {
  id: string;
  ownerId: string;
  ownerLogin: string;
  ownerType: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
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

export const isGitHubPathComponent = (
  value: string | null | undefined,
): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);

export type GitHubPullRequestActionInput = GitHubPullRequestInput & {
  action: "create" | "update" | "comment" | "close" | "reopen";
  comment?: string;
  number?: number;
  supersedeExisting?: boolean;
};

export type GitHubPublishPullRequestInput = {
  title: string;
  body?: string | undefined;
  draft?: boolean | undefined;
};

export type GitHubPublishRuntime = {
  simpleExec(
    containerName: string,
    command: string,
    cwd: string,
    options?: SimpleExecOptions,
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    truncated: boolean;
  }>;
};

type PullRequestRow = {
  id: string;
  sessionId: string;
  messageId: string | null;
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
  listOAuthRepositories(
    accessToken: string,
    options?: { page?: number; perPage?: number },
  ): Promise<GitHubRepositoryRecord[]>;
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
  getPullRequest?: (
    installationId: string,
    owner: string,
    name: string,
    number: number,
  ) => Promise<GitHubPullRequestRecord>;
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

const timedGitHubApiCall = <T>(
  operation: string,
  fields: Record<string, unknown>,
  call: () => Promise<T>,
): Promise<T> => {
  const startedAt = process.hrtime.bigint();
  return call().finally(() => {
    logger.debug("github_api_call_timing", {
      operation,
      durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
      ...fields,
    });
  });
};

const githubCacheTtlMs = 30_000;

type GitHubCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const cachedGitHubRequest = <T>(
  cache: Map<string, GitHubCacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> => {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  if (existing) cache.delete(key);
  const promise = load();
  cache.set(key, { expiresAt: Date.now() + githubCacheTtlMs, promise });
  void promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
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
    const timing = { pageCount: 0, resultCount: 0 };
    return timedGitHubApiCall("listAppInstallations", timing, async () => {
      for (let page = 1; ; page += 1) {
        timing.pageCount = page;
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
        timing.resultCount = installations.length;
        if (data.length < 100) return installations;
      }
    });
  }

  async listOAuthRepositories(
    accessToken: string,
    options: { page?: number; perPage?: number } = {},
  ): Promise<GitHubRepositoryRecord[]> {
    const page = options.page ?? 1;
    const perPage = options.perPage ?? 20;
    const timing = { page, perPage, pageCount: 0, resultCount: 0 };
    return timedGitHubApiCall("listOAuthRepositories", timing, async () => {
      const octokit = new Octokit({ auth: accessToken });
      const response = await octokit.rest.repos.listForAuthenticatedUser({
        affiliation: "owner",
        visibility: "all",
        sort: "updated",
        direction: "desc",
        per_page: perPage,
        page,
      });
      timing.pageCount = 1;
      const repositories = response.data;
      const result = repositories.map((repository) => ({
        id: String(repository.id),
        ownerId: String(repository.owner.id),
        ownerLogin: repository.owner.login,
        ownerType: repository.owner.type,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        defaultBranch: repository.default_branch,
        updatedAt: repository.updated_at ?? "",
      }));
      timing.resultCount = result.length;
      return result;
    });
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
    return timedGitHubApiCall(
      "createInstallationToken",
      { installationId },
      async () => {
        const octokit = await this.app.getInstallationOctokit(
          Number(installationId),
        );
        const authentication = (await octokit.auth({
          type: "installation",
        })) as { token?: unknown };
        if (typeof authentication.token !== "string" || !authentication.token)
          throw new Error("GitHub installation token was missing");
        return authentication.token;
      },
    );
  }

  async listInstallationRepositories(
    installationId: string,
  ): Promise<GitHubRepositoryRecord[]> {
    const repositories: GitHubRepositoryRecord[] = [];
    const timing = { installationId, resultCount: 0 };
    return timedGitHubApiCall(
      "listInstallationRepositories",
      timing,
      async () => {
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
            updatedAt: item.repository.updated_at ?? "",
          });
          timing.resultCount = repositories.length;
        }
        return repositories;
      },
    );
  }

  async listBranches(
    installationId: string,
    owner: string,
    name: string,
  ): Promise<GitHubBranchRecord[]> {
    const branches: GitHubBranchRecord[] = [];
    const timing = {
      installationId,
      owner,
      repo: name,
      pageCount: 0,
      resultCount: 0,
    };
    return timedGitHubApiCall("listBranches", timing, async () => {
      const octokit = (await this.app.getInstallationOctokit(
        Number(installationId),
      )) as unknown as InstallationOctokit;
      for (let page = 1; ; page += 1) {
        timing.pageCount = page;
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
        timing.resultCount = branches.length;
        if (data.length < 100) return branches;
      }
    });
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

  async getPullRequest(
    installationId: string,
    owner: string,
    name: string,
    number: number,
  ): Promise<GitHubPullRequestRecord> {
    const data = (await this.installationRequest(
      installationId,
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { owner, repo: name, pull_number: number },
    )) as Record<string, unknown>;
    return pullRequestRecord(data, {}, number);
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
    status:
      data.merged === true
        ? "merged"
        : data.state === "closed"
          ? "closed"
          : "open",
    state: data.state === "closed" ? "closed" : "open",
    draft: typeof data.draft === "boolean" ? data.draft : (input.draft ?? true),
  };
};

const bounded = (value: string, limit = 300): string =>
  value.length > limit ? `${value.slice(0, limit)}...` : value;

const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

const authenticatedGit = (command: string): string =>
  `token=$(cat) && export GITHUB_TOKEN="$token" GIT_TERMINAL_PROMPT=0 && git -c core.hooksPath=/dev/null -c credential.helper= -c ${shellQuote('credential.helper=!f() { echo username=x-access-token; echo password="$GITHUB_TOKEN"; }; f')} ${command}`;

const isExpectedGitHubRemote = (
  value: string,
  owner: string,
  name: string,
): boolean => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const path = decodeURIComponent(url.pathname)
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    return path.toLowerCase() === `/${owner}/${name}`.toLowerCase();
  } catch {
    return false;
  }
};

const githubFailure = (error: unknown): GitHubResponseFailure => {
  const candidate = error as {
    code?: unknown;
    response?: {
      status?: unknown;
      data?: { message?: unknown; code?: unknown; errors?: unknown };
    };
    message?: unknown;
  };
  const response = candidate.response;
  const errors = Array.isArray(response?.data?.errors)
    ? response.data.errors.flatMap((item) => {
        if (typeof item === "string") return [bounded(item)];
        if (typeof item !== "object" || item === null || Array.isArray(item))
          return [];
        const record = item as Record<string, unknown>;
        const parts = [
          record.resource,
          record.field,
          record.code,
          record.message,
        ].filter(
          (part): part is string => typeof part === "string" && part.length > 0,
        );
        return parts.length ? [bounded(parts.join(": "))] : [];
      })
    : [];
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
    ...(errors.length ? { errors } : {}),
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
  action: GitHubPullRequestToolResult["action"],
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
  private readonly repositoryCache = new Map<
    string,
    GitHubCacheEntry<GitHubRepositoriesResponse>
  >();
  private readonly branchCache = new Map<
    string,
    GitHubCacheEntry<GitHubBranch[]>
  >();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Config,
    api?: GitHubApi,
    private readonly events?: Pick<
      EventStore,
      "appendSessionEvent" | "appendSessionEventInTransaction"
    >,
    private readonly publish: (event: PublicEvent) => void = () => undefined,
  ) {
    this.api = api ?? new OctokitGitHubApi(config);
  }

  installUrl(): string {
    return this.config.GITHUB_APP_INSTALL_URL;
  }

  private clearRepositoryCache(userId: string): void {
    for (const key of this.repositoryCache.keys()) {
      if (key === userId || key.startsWith(`${userId}:`))
        this.repositoryCache.delete(key);
    }
    this.branchCache.clear();
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
    if (!row) return null;
    if (row.number === null || !this.api.getPullRequest)
      return pullRequestMetadata(row);
    try {
      const latest = await this.api.getPullRequest(
        row.installationId,
        row.owner,
        row.repo,
        row.number,
      );
      const data = {
        number: latest.number,
        nodeId: latest.nodeId ?? row.nodeId,
        url: latest.url ?? row.url,
        branch: latest.branch || row.branch,
        baseBranch: latest.baseBranch || row.baseBranch,
        title: latest.title || row.title,
        status: latest.status,
        draft: latest.draft,
        failureCode: null,
        failureMessage: null,
        closedAt:
          latest.status === "closed" || latest.status === "merged"
            ? (row.closedAt ?? new Date())
            : null,
      };
      if (
        data.nodeId === row.nodeId &&
        data.url === row.url &&
        data.branch === row.branch &&
        data.baseBranch === row.baseBranch &&
        data.title === row.title &&
        data.status === row.status &&
        data.draft === row.draft &&
        data.failureCode === row.failureCode &&
        data.failureMessage === row.failureMessage &&
        data.closedAt?.getTime() === row.closedAt?.getTime()
      )
        return pullRequestMetadata(row);
      const next = await this.prisma.pullRequest.update({
        where: { id: row.id },
        data,
      });
      return pullRequestMetadata(next);
    } catch {
      return pullRequestMetadata(row);
    }
  }

  async publishPullRequest(
    sessionId: string,
    messageId: string,
    target: { runtime: GitHubPublishRuntime; containerName: string },
    input: GitHubPublishPullRequestInput,
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<GitHubPullRequestToolResult> {
    const repository = await this.sessionRepository(sessionId);
    const baseBranch = repository.baseBranch ?? repository.defaultBranch;
    if (!baseBranch)
      return operationFailure(
        "publish",
        "github_base_branch_missing",
        "A GitHub base branch is required",
      );
    const title = input.title;
    if (!title)
      return operationFailure(
        "publish",
        "invalid_pull_request_input",
        "A title is required to publish a pull request",
      );

    const remote = await this.publishExec(
      target,
      "git remote get-url --push origin",
      options,
    );
    if (
      !remote.success ||
      !isExpectedGitHubRemote(
        remote.stdout.trim(),
        repository.owner,
        repository.name,
      )
    )
      return operationFailure(
        "publish",
        "git_remote_mismatch",
        "The configured Git remote does not match the session repository",
      );

    const branch = githubSessionBranch(sessionId);
    if (
      sameGitBranch(repository.baseBranch, branch) ||
      sameGitBranch(repository.defaultBranch, branch)
    )
      return operationFailure(
        "publish",
        "protected_git_branch",
        "Refusing to publish the session base branch",
      );

    const currentBranch = await this.publishExec(
      target,
      "git branch --show-current",
      options,
    );
    if (!currentBranch.success)
      return operationFailure(
        "publish",
        currentBranch.code,
        currentBranch.message,
      );
    if (!sameGitBranch(currentBranch.stdout.trim(), branch)) {
      const dirty = await this.publishExec(
        target,
        "git status --porcelain=v1",
        options,
      );
      if (!dirty.success)
        return operationFailure("publish", dirty.code, dirty.message);
      if (dirty.stdout.trim())
        return operationFailure(
          "publish",
          "git_branch_mismatch",
          "Workspace changes are not on the expected session branch",
        );
      const checkout = await this.publishExec(
        target,
        `git checkout ${shellQuote(branch)}`,
        options,
      );
      if (!checkout.success)
        return operationFailure("publish", checkout.code, checkout.message);
    }

    const status = await this.publishExec(
      target,
      "git status --porcelain=v1",
      options,
    );
    if (!status.success)
      return operationFailure("publish", status.code, status.message);
    if (!status.stdout.trim())
      return operationFailure(
        "publish",
        "no_workspace_diff",
        "Refusing to publish a pull request without workspace changes",
      );

    const current = await this.prisma.pullRequest.findFirst({
      where: { sessionId, isCurrent: true },
      orderBy: { createdAt: "desc" },
    });
    const existing =
      current && current.number !== null
        ? { ...current, number: current.number }
        : null;
    if (existing && !sameGitBranch(existing.branch, branch))
      return operationFailure(
        "publish",
        "pull_request_branch_mismatch",
        "The current pull request is not attached to the session branch",
        pullRequestMetadata(existing),
      );

    let token: string | undefined;
    if (existing) {
      try {
        token = await this.createInstallationToken(repository.installationId);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        return this.failUpdatingPullRequest(
          sessionId,
          messageId,
          existing,
          error instanceof ServiceError
            ? error.code
            : "github_installation_token_failed",
          error instanceof ServiceError
            ? error.message
            : "GitHub installation token could not be created",
        );
      }
      const fetched = await this.publishExec(
        target,
        authenticatedGit(
          `fetch --no-tags origin ${shellQuote(`refs/heads/${branch}`)}`,
        ),
        { ...options, stdin: token },
      );
      if (!fetched.success)
        return this.failUpdatingPullRequest(
          sessionId,
          messageId,
          existing,
          fetched.code,
          fetched.message,
        );
      const aligned = await this.publishExec(
        target,
        "git reset --mixed FETCH_HEAD",
        options,
      );
      if (!aligned.success)
        return this.failUpdatingPullRequest(
          sessionId,
          messageId,
          existing,
          aligned.code,
          aligned.message,
        );
      const syncedStatus = await this.publishExec(
        target,
        "git status --porcelain=v1",
        options,
      );
      if (!syncedStatus.success)
        return this.failUpdatingPullRequest(
          sessionId,
          messageId,
          existing,
          syncedStatus.code,
          syncedStatus.message,
        );
      if (!syncedStatus.stdout.trim())
        return operationFailure(
          "publish",
          "no_workspace_diff",
          "Refusing to publish a pull request without workspace changes",
          pullRequestMetadata(existing),
        );
    }

    let row: PullRequestRow;
    if (existing) row = existing;
    else {
      const creating = await this.prisma.$transaction(async (tx) => {
        await tx.pullRequest.updateMany({
          where: { sessionId, isCurrent: true },
          data: { isCurrent: false },
        });
        const created = await tx.pullRequest.create({
          data: {
            id: `pr_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
            sessionId,
            messageId,
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
        const event = await this.appendSessionEventInTransaction(
          tx,
          sessionId,
          messageId,
          "pull_request_creation_started",
          created,
          { pull_request: pullRequestMetadata(created) },
        );
        return { row: created, event };
      });
      if (creating.event) this.publish(creating.event);
      row = creating.row;
    }

    const fail = (
      code: string,
      message: string,
      github: GitHubResponseFailure | null = null,
    ): Promise<GitHubPullRequestToolResult> =>
      existing
        ? this.failUpdatingPullRequest(
            sessionId,
            messageId,
            row,
            code,
            message,
            github,
          )
        : this.failPublishingPullRequest(
            sessionId,
            messageId,
            row,
            code,
            message,
            github,
          );

    const add = await this.publishExec(target, "git add -A", options);
    if (!add.success) {
      await this.resetWorkspaceIndex(target, options);
      return fail(add.code, add.message);
    }

    const commit = await this.publishExec(
      target,
      `git -c user.name=${shellQuote("Agent Sandbox")} -c user.email=${shellQuote("agent-sandbox@example.invalid")} -c core.hooksPath=/dev/null commit --no-verify -m ${shellQuote(title)}`,
      options,
    );
    if (!commit.success) {
      await this.resetWorkspaceIndex(target, options);
      return fail(commit.code, commit.message);
    }

    const failAfterCommit = async (
      code: string,
      message: string,
      github: GitHubResponseFailure | null = null,
    ) => {
      await this.resetPublishedCommit(target, options);
      return fail(code, message, github);
    };

    if (!token) {
      try {
        token = await this.createInstallationToken(repository.installationId);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        return failAfterCommit(
          error instanceof ServiceError
            ? error.code
            : "github_installation_token_failed",
          error instanceof ServiceError
            ? error.message
            : "GitHub installation token could not be created",
        );
      }
    }
    const pushed = await this.publishExec(
      target,
      authenticatedGit(
        `push --no-verify origin ${shellQuote(`HEAD:refs/heads/${branch}`)}`,
      ),
      { ...options, stdin: token },
    );
    if (!pushed.success) return failAfterCommit(pushed.code, pushed.message);

    const pushedEvent = await this.events?.appendSessionEvent({
      sessionId,
      messageId,
      type: "pull_request_branch_pushed",
      producerService: "github",
      producerId: row.id,
      correlationId: randomUUID(),
      domain: "pull_request",
      payload: { branch },
    });
    if (pushedEvent) this.publish(pushedEvent);

    if (existing) {
      let updated: GitHubPullRequestToolResult;
      try {
        updated = await this.pullRequest(sessionId, messageId, {
          action: "update",
          number: existing.number,
          title,
          baseBranch,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        });
      } catch (error) {
        await this.resetPublishedCommit(target, options);
        throw error;
      }
      await this.resetPublishedCommit(target, options);
      return { ...updated, action: "publish" };
    }

    if (!this.api.createPullRequest)
      return failAfterCommit(
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
      return failAfterCommit(
        "github_pull_request_failed",
        "GitHub pull request creation failed",
        github,
      );
    }

    await this.resetPublishedCommit(target, options);
    const next = await this.persistPullRequestUpdate(
      sessionId,
      messageId,
      row,
      {
        number: created.number,
        nodeId: created.nodeId,
        url: created.url,
        branch: created.branch || branch,
        baseBranch: created.baseBranch || baseBranch,
        title: created.title || title,
        status: created.state,
        draft: created.draft,
        failureCode: null,
        failureMessage: null,
        closedAt: null,
        openedAt: new Date(),
      },
      "pull_request_created",
    );
    return operationSuccess("publish", pullRequestMetadata(next));
  }

  private async publishExec(
    target: { runtime: GitHubPublishRuntime; containerName: string },
    command: string,
    options: { timeoutMs: number; signal: AbortSignal; stdin?: string },
  ): Promise<
    | { success: true; stdout: string }
    | { success: false; code: string; message: string }
  > {
    if (options.signal.aborted) {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    try {
      const result = await target.runtime.simpleExec(
        target.containerName,
        command,
        workspaceRoot,
        {
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
        },
      );
      if (options.signal.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      if (result.timedOut)
        return {
          success: false,
          code: "git_publish_timed_out",
          message: "Git publication timed out",
        };
      if (result.exitCode !== 0)
        return {
          success: false,
          code: "git_publish_failed",
          message: "Git publication could not be completed",
        };
      return { success: true, stdout: result.stdout };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      return {
        success: false,
        code: "git_publish_failed",
        message: "Git publication could not be completed",
      };
    }
  }

  private async resetPublishedCommit(
    target: { runtime: GitHubPublishRuntime; containerName: string },
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<void> {
    await this.publishExec(target, "git reset --mixed HEAD~1", options).catch(
      () => undefined,
    );
  }

  private async resetWorkspaceIndex(
    target: { runtime: GitHubPublishRuntime; containerName: string },
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<void> {
    await this.publishExec(target, "git reset --mixed HEAD", options).catch(
      () => undefined,
    );
  }

  private async failPublishingPullRequest(
    sessionId: string,
    messageId: string,
    row: PullRequestRow,
    code: string,
    message: string,
    github: GitHubResponseFailure | null = null,
  ): Promise<GitHubPullRequestToolResult> {
    const next = await this.persistPullRequestUpdate(
      sessionId,
      messageId,
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
      "publish",
      code,
      message,
      pullRequestMetadata(next),
      github,
    );
  }

  private async failUpdatingPullRequest(
    sessionId: string,
    messageId: string,
    row: PullRequestRow,
    code: string,
    message: string,
    github: GitHubResponseFailure | null = null,
  ): Promise<GitHubPullRequestToolResult> {
    const next = await this.persistPullRequestFailure(
      sessionId,
      messageId,
      "update",
      row,
      code,
      message,
      github,
    );
    return operationFailure(
      "publish",
      code,
      message,
      pullRequestMetadata(next),
      github,
    );
  }

  async pullRequest(
    sessionId: string,
    messageId: string,
    input: GitHubPullRequestActionInput,
  ): Promise<GitHubPullRequestToolResult> {
    const repository = await this.sessionRepository(sessionId);
    if (input.action === "create")
      return this.createPullRequest(sessionId, messageId, repository, input);

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
          messageId,
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
          messageId,
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
      const next = await this.persistPullRequestComment(
        sessionId,
        messageId,
        row,
      );
      return operationSuccess(input.action, pullRequestMetadata(next));
    }

    if (!this.api.updatePullRequest) {
      const next = await this.persistPullRequestFailure(
        sessionId,
        messageId,
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
            messageId,
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
        messageId,
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
          : updated.status;
    const next = await this.persistPullRequestUpdate(
      sessionId,
      messageId,
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
    messageId: string,
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
          messageId,
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
      const event = await this.appendSessionEventInTransaction(
        tx,
        sessionId,
        messageId,
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
        messageId,
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
        messageId,
        creating.row,
        "github_pull_request_failed",
        "GitHub pull request creation failed",
        github,
      );
    }
    const next = await this.persistPullRequestUpdate(
      sessionId,
      messageId,
      creating.row,
      {
        number: created.number,
        nodeId: created.nodeId,
        url: created.url,
        branch: created.branch || branch,
        baseBranch: created.baseBranch || baseBranch,
        title: created.title || title,
        status: created.state,
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
    messageId: string,
    row: PullRequestRow,
    code: string,
    message: string,
    github: GitHubResponseFailure | null = null,
  ): Promise<GitHubPullRequestToolResult> {
    const next = await this.persistPullRequestUpdate(
      sessionId,
      messageId,
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
    messageId: string,
    row: PullRequestRow,
    data: {
      number: number | null;
      nodeId: string | null;
      url: string | null;
      branch: string;
      baseBranch: string;
      title: string;
      status: PullRequestMetadata["status"];
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
      const event = await this.appendSessionEventInTransaction(
        tx,
        sessionId,
        messageId,
        eventType,
        next,
        { pull_request: pullRequestMetadata(next) },
      );
      return { next, event };
    });
    if (result.event) this.publish(result.event);
    return result.next;
  }

  private async appendSessionEventInTransaction(
    tx: Parameters<
      NonNullable<EventStore["appendSessionEventInTransaction"]>
    >[0],
    sessionId: string,
    messageId: string,
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
    if (!this.events?.appendSessionEventInTransaction) return null;
    return this.events.appendSessionEventInTransaction(tx, {
      sessionId,
      messageId,
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
    messageId: string,
    row: PullRequestRow,
  ): Promise<PullRequestRow> {
    const result = await this.prisma.$transaction(async (tx) => {
      const next = row.failureCode
        ? await tx.pullRequest.update({
            where: { id: row.id },
            data: { failureCode: null, failureMessage: null },
          })
        : row;
      const event = await this.appendSessionEventInTransaction(
        tx,
        sessionId,
        messageId,
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
    messageId: string,
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
      const event = await this.appendSessionEventInTransaction(
        tx,
        sessionId,
        messageId,
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
      this.clearRepositoryCache(userId);
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

  async repositories(
    userId: string,
    options: { forceRefresh?: boolean; cursor?: string; limit?: number } = {},
  ): Promise<GitHubRepositoriesResponse> {
    if (options.forceRefresh) this.clearRepositoryCache(userId);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 20);
    const page =
      options.cursor && /^\d+$/.test(options.cursor)
        ? Math.max(Number(options.cursor), 1)
        : 1;
    return cachedGitHubRequest(
      this.repositoryCache,
      `${userId}:${page}:${limit}`,
      () => this.loadRepositories(userId, { page, limit }),
    );
  }

  private async loadRepositories(
    userId: string,
    options: { page: number; limit: number },
  ): Promise<GitHubRepositoriesResponse> {
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
        await this.api.listOAuthRepositories(accessToken, {
          page: options.page,
          perPage: options.limit,
        })
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
            updatedAt: oauthRepository.updatedAt,
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
          right.updatedAt.localeCompare(left.updatedAt),
        ),
        nextCursor:
          oauthRepositories.length === options.limit
            ? String(options.page + 1)
            : null,
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

  async branches(
    userId: string,
    selection: GitHubRepositorySelection,
    options: { forceRefresh?: boolean } = {},
  ): Promise<GitHubBranch[]> {
    const { repoId, owner, name, installationId } = selection;
    if (
      !repoId?.trim() ||
      !isGitHubPathComponent(owner) ||
      !isGitHubPathComponent(name) ||
      !installationId ||
      !/^\d+$/.test(installationId)
    )
      throw new ServiceError(
        "github_repository_metadata_invalid",
        "GitHub repository metadata is invalid",
        400,
      );
    try {
      const installation = await this.prisma.gitHubInstallation.findUnique({
        where: { userId_installationId: { userId, installationId } },
        select: { installationId: true },
      });
      if (!installation)
        throw new ServiceError(
          "github_repository_not_found",
          "Repository was not found",
          404,
        );
      const cacheKey = `${installationId}:${owner}:${name}`;
      if (options.forceRefresh) this.branchCache.delete(cacheKey);
      return await cachedGitHubRequest(this.branchCache, cacheKey, () =>
        this.api.listBranches(installationId, owner, name),
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
