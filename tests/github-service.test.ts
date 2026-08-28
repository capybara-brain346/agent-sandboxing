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
