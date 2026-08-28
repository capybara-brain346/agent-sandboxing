import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import type {
  GitHubBranch,
  GitHubInstallationView,
  GitHubRepositoriesResponse,
  GitHubRepositoryView,
} from "../../types/github.types";
import { decryptToken } from "../auth/token-crypto";

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
}

export class GitHubService {
  private readonly api: GitHubApi;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Config,
    api?: GitHubApi,
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
