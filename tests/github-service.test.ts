import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config";
import { GitHubService, type GitHubApi } from "../src/services/github/github";
import { encryptToken } from "../src/services/auth/token-crypto";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
});

describe("GitHubService", () => {
  const pullRequestRow = (data: Record<string, unknown>) => ({
    id: "pr_1",
    sessionId: "chat_1",
    runId: "run_1",
    provider: "github",
    owner: "octo",
    repo: "repo",
    installationId: "10",
    number: null,
    nodeId: null,
    url: null,
    branch: "feature/test",
    baseBranch: "main",
    title: "Fix it",
    status: "creating",
    draft: true,
    isCurrent: true,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    openedAt: null,
    closedAt: null,
    ...data,
  });

  it("creates a draft pull request and persists compact metadata", async () => {
    const created = pullRequestRow({
      number: 7,
      nodeId: "node_7",
      url: "https://github.com/octo/repo/pull/7",
      status: "open",
    });
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow(data),
    );
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...created, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(async () => ({
        number: 7,
        nodeId: "node_7",
        url: "https://github.com/octo/repo/pull/7",
        branch: "feature/test",
        baseBranch: "main",
        title: "Fix it",
        state: "open" as const,
        draft: true,
      })),
    };
    const prisma = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          repoSource: "github",
          repoOwner: "octo",
          repoName: "repo",
          repoInstallationId: "10",
          repoBaseBranch: "main",
          repoDefaultBranch: "main",
        })),
      },
      pullRequest: {
        findFirst: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          pullRequest: { create, update, updateMany: vi.fn() },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.pullRequest("chat_1", "run_1", {
        action: "create",
        branch: "feature/test",
        title: "Fix it",
      }),
    ).resolves.toMatchObject({
      success: true,
      action: "create",
      pullRequest: {
        number: 7,
        status: "open",
        draft: true,
        url: "https://github.com/octo/repo/pull/7",
      },
    });
    expect(api.createPullRequest).toHaveBeenCalledWith(
      "10",
      "octo",
      "repo",
      expect.objectContaining({ draft: true }),
    );
    expect(update).toHaveBeenCalled();
  });

  it("persists a failed create attempt without exposing GitHub diagnostics", async () => {
    const creating = pullRequestRow({});
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...creating, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(async () => {
        throw Object.assign(new Error("private token"), {
          response: {
            status: 422,
            data: {
              message: "Validation failed",
              errors: [{ message: "No commits between main and feature/test" }],
            },
          },
        });
      }),
    };
    const prisma = {
      chatSession: {
        findUnique: vi.fn(async () => ({
          repoSource: "github",
          repoOwner: "octo",
          repoName: "repo",
          repoInstallationId: "10",
          repoBaseBranch: "main",
          repoDefaultBranch: "main",
        })),
      },
      pullRequest: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          pullRequest: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
              pullRequestRow(data),
            ),
            update,
            updateMany: vi.fn(),
          },
        }),
      ),
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    const result = await service.pullRequest("chat_1", "run_1", {
      action: "create",
      branch: "feature/test",
      title: "Fix it",
    });

    expect(result).toMatchObject({
      success: false,
      failure: { code: "github_pull_request_failed" },
      pullRequest: {
        status: "failed",
        failure: { code: "github_pull_request_failed" },
      },
      github: {
        status: 422,
        message: "Validation failed",
        errors: ["No commits between main and feature/test"],
      },
    });
    expect(JSON.stringify(result)).not.toContain("private token");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", isCurrent: false }),
      }),
    );
  });

  it("intersects OAuth-visible personal repositories with App installations", async () => {
    const encrypted = encryptToken(
      "oauth-token",
      config.AUTH_TOKEN_ENCRYPTION_KEY,
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(async () => []),
      listOAuthRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "main",
        },
        {
          id: "2",
          ownerId: "99",
          ownerLogin: "org",
          ownerType: "Organization",
          name: "ignored",
          fullName: "org/ignored",
          private: true,
          defaultBranch: "main",
        },
      ]),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: false,
          defaultBranch: "trunk",
        },
        {
          id: "2",
          ownerId: "99",
          ownerLogin: "org",
          ownerType: "Organization",
          name: "ignored",
          fullName: "org/ignored",
          private: true,
          defaultBranch: "main",
        },
      ]),
      listBranches: vi.fn(async () => [
        { name: "main", sha: "abc", protected: true },
        { name: "feature", sha: "def", protected: false },
      ]),
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ githubUserId: "42" })) },
      gitHubOAuthToken: {
        findUnique: vi.fn(async () => ({
          accessTokenCiphertext: encrypted.ciphertext,
          accessTokenIv: encrypted.iv,
          accessTokenTag: encrypted.tag,
        })),
      },
      gitHubInstallation: {
        findMany: vi.fn(async () => [
          {
            installationId: "10",
            accountLogin: "octo",
            accountType: "User",
          },
        ]),
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(service.repositories("user_1")).resolves.toEqual({
      installations: [
        { installationId: "10", accountLogin: "octo", accountType: "user" },
      ],
      repositories: [
        {
          repoId: "1",
          owner: "octo",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "trunk",
          installationId: "10",
          branches: [],
        },
      ],
      installUrl: config.GITHUB_APP_INSTALL_URL,
    });
    expect(api.listBranches).not.toHaveBeenCalled();
  });

  it("only saves installations owned by the authenticated personal account", async () => {
    const upsert = vi.fn(async () => ({
      installationId: "10",
      accountLogin: "octo",
      accountType: "User",
    }));
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      getInstallation: vi.fn(async () => ({
        accountId: "42",
        accountLogin: "octo",
        accountType: "User",
      })),
      createInstallationToken: vi.fn(),
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ githubUserId: "42" })) },
      gitHubInstallation: { upsert },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);
    await expect(
      service.saveInstallation("user_1", "10"),
    ).resolves.toMatchObject({
      installationId: "10",
      accountType: "user",
    });
    expect(upsert).toHaveBeenCalled();

    vi.spyOn(api, "getInstallation").mockResolvedValue({
      accountId: "99",
      accountLogin: "other",
      accountType: "User",
    });
    await expect(
      service.saveInstallation("user_1", "11"),
    ).rejects.toMatchObject({
      code: "github_installation_not_allowed",
      status: 403,
    });
  });

  it("saves an already-installed personal app installation while listing repositories", async () => {
    const encrypted = encryptToken(
      "oauth-token",
      config.AUTH_TOKEN_ENCRYPTION_KEY,
    );
    const upsert = vi.fn(async () => ({
      installationId: "10",
      accountLogin: "octo",
      accountType: "User",
    }));
    const api: GitHubApi = {
      listAppInstallations: vi.fn(async () => [
        {
          installationId: "10",
          accountId: "42",
          accountLogin: "octo",
          accountType: "User",
        },
      ]),
      listOAuthRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "main",
        },
      ]),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "main",
        },
      ]),
      listBranches: vi.fn(async () => [
        { name: "main", sha: "abc", protected: false },
      ]),
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ githubUserId: "42" })) },
      gitHubOAuthToken: {
        findUnique: vi.fn(async () => ({
          accessTokenCiphertext: encrypted.ciphertext,
          accessTokenIv: encrypted.iv,
          accessTokenTag: encrypted.tag,
        })),
      },
      gitHubInstallation: {
        findMany: vi.fn(async () => []),
        upsert,
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(service.repositories("user_1")).resolves.toMatchObject({
      installations: [
        { installationId: "10", accountLogin: "octo", accountType: "user" },
      ],
      repositories: [{ fullName: "octo/repo", installationId: "10" }],
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ installationId: "10" }),
      }),
    );
  });

  it("loads branches for one selected repository", async () => {
    const encrypted = encryptToken(
      "oauth-token",
      config.AUTH_TOKEN_ENCRYPTION_KEY,
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(async () => []),
      listOAuthRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "main",
        },
      ]),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(async () => [
        {
          id: "1",
          ownerId: "42",
          ownerLogin: "octo",
          ownerType: "User",
          name: "repo",
          fullName: "octo/repo",
          private: true,
          defaultBranch: "main",
        },
      ]),
      listBranches: vi.fn(async () => [
        { name: "main", sha: "abc", protected: false },
      ]),
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ githubUserId: "42" })) },
      gitHubOAuthToken: {
        findUnique: vi.fn(async () => ({
          accessTokenCiphertext: encrypted.ciphertext,
          accessTokenIv: encrypted.iv,
          accessTokenTag: encrypted.tag,
        })),
      },
      gitHubInstallation: {
        findMany: vi.fn(async () => [
          {
            installationId: "10",
            accountLogin: "octo",
            accountType: "User",
          },
        ]),
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(service.branches("user_1", "1")).resolves.toEqual([
      { name: "main", sha: "abc", protected: false },
    ]);
    expect(api.listBranches).toHaveBeenCalledWith("10", "octo", "repo");
  });

  it("mints an installation token through the GitHub App seam", async () => {
    const createInstallationToken = vi.fn(async () => "installation-token");
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken,
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
    };
    const service = new GitHubService({} as PrismaClient, config, api);

    await expect(service.createInstallationToken("10")).resolves.toBe(
      "installation-token",
    );
    expect(createInstallationToken).toHaveBeenCalledWith("10");
  });
});
