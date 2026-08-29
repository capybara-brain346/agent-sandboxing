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
    messageId: "msg_1",
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
        status: "open" as const,
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
      service.pullRequest("chat_1", "msg_1", {
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

  it("refreshes the current pull request from GitHub", async () => {
    const row = pullRequestRow({
      number: 7,
      nodeId: "node_7",
      url: "https://github.com/octo/repo/pull/7",
      status: "open",
      draft: true,
      openedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...row, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      getPullRequest: vi.fn(async () => ({
        number: 7,
        nodeId: "node_7",
        url: "https://github.com/octo/repo/pull/7",
        branch: "feature/test",
        baseBranch: "main",
        title: "Fix it",
        status: "open" as const,
        state: "open" as const,
        draft: false,
      })),
    };
    const prisma = {
      pullRequest: {
        findFirst: vi.fn(async () => row),
        update,
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(service.currentPullRequest("chat_1")).resolves.toMatchObject({
      number: 7,
      status: "open",
      draft: false,
    });
    expect(api.getPullRequest).toHaveBeenCalledWith("10", "octo", "repo", 7);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pr_1" },
        data: expect.objectContaining({ status: "open", draft: false }),
      }),
    );
  });

  it("maps merged GitHub pull requests to merged status", async () => {
    const row = pullRequestRow({
      number: 7,
      status: "open",
      draft: false,
      openedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...row, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      getPullRequest: vi.fn(async () => ({
        number: 7,
        nodeId: "node_7",
        url: "https://github.com/octo/repo/pull/7",
        branch: "feature/test",
        baseBranch: "main",
        title: "Fix it",
        status: "merged" as const,
        state: "closed" as const,
        draft: false,
      })),
    };
    const prisma = {
      pullRequest: {
        findFirst: vi.fn(async () => row),
        update,
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(service.currentPullRequest("chat_1")).resolves.toMatchObject({
      status: "merged",
      draft: false,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "merged", draft: false }),
      }),
    );
  });

  it("publishes a workspace diff as a deterministic pull request", async () => {
    const token = "installation-token";
    const creating = pullRequestRow({
      branch: "agent/chat_1",
      title: "Fix it",
    });
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow(data),
    );
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...creating, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(async () => token),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(async () => ({
        number: 7,
        nodeId: "node_7",
        url: "https://github.com/octo/repo/pull/7",
        branch: "agent/chat_1",
        baseBranch: "main",
        title: "Fix it",
        status: "open" as const,
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
      pullRequest: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          pullRequest: { create, update, updateMany: vi.fn() },
        }),
      ),
    } as unknown as PrismaClient;
    const runtime = {
      simpleExec: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: "https://github.com/octo/repo.git\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: "agent/chat_1\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: " M file.txt\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValue({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        }),
    };
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.publishPullRequest(
        "chat_1",
        "msg_1",
        { runtime, containerName: "sandbox-1" },
        { title: "Fix it" },
        { timeoutMs: 300, signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      success: true,
      action: "publish",
      pullRequest: {
        branch: "agent/chat_1",
        baseBranch: "main",
        number: 7,
        status: "open",
      },
    });
    expect(api.createInstallationToken).toHaveBeenCalledWith("10");
    expect(api.createPullRequest).toHaveBeenCalledWith(
      "10",
      "octo",
      "repo",
      expect.objectContaining({
        branch: "agent/chat_1",
        baseBranch: "main",
        draft: true,
      }),
    );
    const pushCall = runtime.simpleExec.mock.calls.find((call) =>
      String(call[1]).includes("push --no-verify"),
    );
    expect(pushCall?.[1]).toContain("'HEAD:refs/heads/agent/chat_1'");
    expect(pushCall?.[1]).not.toContain(token);
    expect(pushCall?.[3]).toMatchObject({ stdin: token });
    expect(runtime.simpleExec.mock.calls.at(-1)?.[1]).toBe(
      "git reset --mixed HEAD~1",
    );
    expect(
      runtime.simpleExec.mock.calls.some((call) =>
        String(call[1]).includes("origin/main"),
      ),
    ).toBe(false);
  });

  it("refuses to publish without a workspace diff", async () => {
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(),
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
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const runtime = {
      simpleExec: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: "https://github.com/octo/repo.git\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: "agent/chat_1\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        }),
    };
    const service = new GitHubService(prisma, config, api);

    const result = await service.publishPullRequest(
      "chat_1",
      "msg_1",
      { runtime, containerName: "sandbox-1" },
      { title: "Fix it" },
      { timeoutMs: 300, signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      success: false,
      failure: { code: "no_workspace_diff" },
    });
    expect(api.createInstallationToken).not.toHaveBeenCalled();
    expect(api.createPullRequest).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("updates the current pull request on the session branch", async () => {
    const token = "installation-token";
    const existing = pullRequestRow({
      number: 7,
      nodeId: "node_7",
      url: "https://github.com/octo/repo/pull/7",
      branch: "agent/chat_1",
      status: "open",
      draft: true,
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...existing, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(async () => token),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(),
      updatePullRequest: vi.fn(async () => ({
        number: 7,
        nodeId: "node_7",
        url: "https://github.com/octo/repo/pull/7",
        branch: "agent/chat_1",
        baseBranch: "main",
        title: "Update it",
        status: "open" as const,
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
      pullRequest: { findFirst: vi.fn(async () => existing) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ pullRequest: { update } }),
      ),
    } as unknown as PrismaClient;
    const ok = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    };
    const runtime = {
      simpleExec: vi.fn(async (_container: string, command: string) => {
        if (command === "git remote get-url --push origin")
          return { ...ok, stdout: "https://github.com/octo/repo.git\n" };
        if (command === "git branch --show-current")
          return { ...ok, stdout: "agent/chat_1\n" };
        if (command === "git status --porcelain=v1")
          return { ...ok, stdout: " M file.txt\n" };
        return ok;
      }),
    };
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.publishPullRequest(
        "chat_1",
        "msg_2",
        { runtime, containerName: "sandbox-1" },
        { title: "Update it", body: "Updated body" },
        { timeoutMs: 300, signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      success: true,
      action: "publish",
      pullRequest: { number: 7, title: "Update it", status: "open" },
    });
    expect(api.createPullRequest).not.toHaveBeenCalled();
    expect(api.updatePullRequest).toHaveBeenCalledWith(
      "10",
      "octo",
      "repo",
      7,
      expect.objectContaining({
        title: "Update it",
        body: "Updated body",
        baseBranch: "main",
      }),
    );
    const fetchCall = runtime.simpleExec.mock.calls.find((call) =>
      String(call[1]).includes("fetch --no-tags"),
    );
    expect(fetchCall?.[1]).toContain("'refs/heads/agent/chat_1'");
    expect(fetchCall?.[1]).not.toContain(token);
    expect(fetchCall?.[3]).toMatchObject({ stdin: token });
    const pushCall = runtime.simpleExec.mock.calls.find((call) =>
      String(call[1]).includes("push --no-verify"),
    );
    expect(pushCall?.[1]).toContain("'HEAD:refs/heads/agent/chat_1'");
    expect(pushCall?.[3]).toMatchObject({ stdin: token });
    expect(runtime.simpleExec.mock.calls.at(-1)?.[1]).toBe(
      "git reset --mixed HEAD~1",
    );
  });

  it("refuses remote mismatch before minting a token", async () => {
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(),
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
    } as unknown as PrismaClient;
    const runtime = {
      simpleExec: vi.fn(async () => ({
        stdout: "https://github.com/other/repo.git\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        truncated: false,
      })),
    };
    const service = new GitHubService(prisma, config, api);

    const result = await service.publishPullRequest(
      "chat_1",
      "msg_1",
      { runtime, containerName: "sandbox-1" },
      { title: "Fix it" },
      { timeoutMs: 300, signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      success: false,
      failure: { code: "git_remote_mismatch" },
    });
    expect(api.createInstallationToken).not.toHaveBeenCalled();
  });

  it("refuses to publish dirty changes from the wrong branch", async () => {
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(),
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
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const runtime = {
      simpleExec: vi
        .fn()
        .mockResolvedValueOnce({
          stdout: "https://github.com/octo/repo.git\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: "main\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
        .mockResolvedValueOnce({
          stdout: " M file.txt\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          truncated: false,
        }),
    };
    const service = new GitHubService(prisma, config, api);

    const result = await service.publishPullRequest(
      "chat_1",
      "msg_1",
      { runtime, containerName: "sandbox-1" },
      { title: "Fix it" },
      { timeoutMs: 300, signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      success: false,
      failure: { code: "git_branch_mismatch" },
    });
    expect(api.createInstallationToken).not.toHaveBeenCalled();
    expect(api.createPullRequest).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(
      runtime.simpleExec.mock.calls.some((call) =>
        String(call[1]).includes("git add"),
      ),
    ).toBe(false);
  });

  it("returns a safe publication failure and restores the workspace after push rejection", async () => {
    const token = "installation-token";
    const creating = pullRequestRow({
      branch: "agent/chat_1",
      title: "Fix it",
    });
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      pullRequestRow({ ...creating, ...data }),
    );
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(async () => token),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
      createPullRequest: vi.fn(),
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
    const ok = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    };
    const runtime = {
      simpleExec: vi
        .fn()
        .mockResolvedValueOnce({
          ...ok,
          stdout: "https://github.com/octo/repo.git\n",
        })
        .mockResolvedValueOnce({ ...ok, stdout: "agent/chat_1\n" })
        .mockResolvedValueOnce({ ...ok, stdout: " M file.txt\n" })
        .mockResolvedValueOnce(ok)
        .mockResolvedValueOnce(ok)
        .mockResolvedValueOnce({
          ...ok,
          stdout: "private installation-token",
          exitCode: 1,
        })
        .mockResolvedValueOnce(ok),
    };
    const service = new GitHubService(prisma, config, api);

    const result = await service.publishPullRequest(
      "chat_1",
      "msg_1",
      { runtime, containerName: "sandbox-1" },
      { title: "Fix it" },
      { timeoutMs: 300, signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      success: false,
      action: "publish",
      failure: { code: "git_publish_failed" },
      pullRequest: { status: "failed" },
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(api.createPullRequest).not.toHaveBeenCalled();
    expect(runtime.simpleExec.mock.calls.at(-1)?.[1]).toBe(
      "git reset --mixed HEAD~1",
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", isCurrent: false }),
      }),
    );
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

    const result = await service.pullRequest("chat_1", "msg_1", {
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

  it("caches repository discovery until expiry and supports refresh", async () => {
    vi.useFakeTimers();
    try {
      const encrypted = encryptToken(
        "oauth-token",
        config.AUTH_TOKEN_ENCRYPTION_KEY,
      );
      const api: GitHubApi = {
        listAppInstallations: vi.fn(async () => []),
        listOAuthRepositories: vi.fn(async () => []),
        getInstallation: vi.fn(),
        createInstallationToken: vi.fn(),
        listInstallationRepositories: vi.fn(async () => []),
        listBranches: vi.fn(),
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
        gitHubInstallation: { findMany: vi.fn(async () => []) },
      } as unknown as PrismaClient;
      const service = new GitHubService(prisma, config, api);

      await service.repositories("user_1");
      await service.repositories("user_1");
      expect(api.listOAuthRepositories).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_000);
      await service.repositories("user_1");
      expect(api.listOAuthRepositories).toHaveBeenCalledTimes(2);

      await service.repositories("user_1", { forceRefresh: true });
      expect(api.listOAuthRepositories).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches branch discovery while checking installation ownership", async () => {
    const listBranches = vi.fn(async () => [
      { name: "main", sha: "abc", protected: false },
    ]);
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches,
    };
    const findUnique = vi.fn(async () => ({ installationId: "10" }));
    const prisma = {
      gitHubInstallation: { findUnique },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);
    const selection = {
      repoId: "1",
      owner: "octo",
      name: "repo",
      installationId: "10",
    };

    await service.branches("user_1", selection);
    await service.branches("user_1", selection);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(listBranches).toHaveBeenCalledTimes(1);

    await service.branches("user_1", selection, { forceRefresh: true });
    expect(listBranches).toHaveBeenCalledTimes(2);
  });

  it("invalidates repository and branch caches after saving an installation", async () => {
    const encrypted = encryptToken(
      "oauth-token",
      config.AUTH_TOKEN_ENCRYPTION_KEY,
    );
    const listOAuthRepositories = vi.fn(async () => []);
    const listBranches = vi.fn(async () => [
      { name: "main", sha: "abc", protected: false },
    ]);
    const api: GitHubApi = {
      listAppInstallations: vi.fn(async () => []),
      listOAuthRepositories,
      getInstallation: vi.fn(async () => ({
        accountId: "42",
        accountLogin: "octo",
        accountType: "User",
      })),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(async () => []),
      listBranches,
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
        findUnique: vi.fn(async () => ({ installationId: "10" })),
        upsert: vi.fn(async () => ({
          installationId: "10",
          accountLogin: "octo",
          accountType: "User",
        })),
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);
    const selection = {
      repoId: "1",
      owner: "octo",
      name: "repo",
      installationId: "10",
    };

    await service.repositories("user_1");
    await service.branches("user_1", selection);
    await service.saveInstallation("user_1", "10");
    await service.repositories("user_1");
    await service.branches("user_1", selection);

    expect(listOAuthRepositories).toHaveBeenCalledTimes(2);
    expect(listBranches).toHaveBeenCalledTimes(2);
  });

  it("loads branches for one selected repository", async () => {
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(async () => [
        { name: "main", sha: "abc", protected: false },
      ]),
    };
    const prisma = {
      gitHubInstallation: {
        findUnique: vi.fn(async () => ({ installationId: "10" })),
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.branches("user_1", {
        repoId: "1",
        owner: "octo",
        name: "repo",
        installationId: "10",
      }),
    ).resolves.toEqual([{ name: "main", sha: "abc", protected: false }]);
    expect(prisma.gitHubInstallation.findUnique).toHaveBeenCalledWith({
      where: {
        userId_installationId: { userId: "user_1", installationId: "10" },
      },
      select: { installationId: true },
    });
    expect(api.listBranches).toHaveBeenCalledWith("10", "octo", "repo");
    expect(api.listAppInstallations).not.toHaveBeenCalled();
    expect(api.listOAuthRepositories).not.toHaveBeenCalled();
    expect(api.listInstallationRepositories).not.toHaveBeenCalled();
  });

  it("rejects branches for an installation not owned by the user", async () => {
    const listBranches = vi.fn();
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches,
    };
    const prisma = {
      gitHubInstallation: {
        findUnique: vi.fn(async () => null),
      },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.branches("user_1", {
        repoId: "1",
        owner: "octo",
        name: "repo",
        installationId: "10",
      }),
    ).rejects.toMatchObject({
      code: "github_repository_not_found",
      status: 404,
    });
    expect(listBranches).not.toHaveBeenCalled();
  });

  it("rejects incomplete or unsafe branch metadata before querying GitHub", async () => {
    const api: GitHubApi = {
      listAppInstallations: vi.fn(),
      listOAuthRepositories: vi.fn(),
      getInstallation: vi.fn(),
      createInstallationToken: vi.fn(),
      listInstallationRepositories: vi.fn(),
      listBranches: vi.fn(),
    };
    const prisma = {
      gitHubInstallation: { findUnique: vi.fn() },
    } as unknown as PrismaClient;
    const service = new GitHubService(prisma, config, api);

    await expect(
      service.branches("user_1", {
        repoId: "1",
        owner: "octo/other",
        name: "repo",
        installationId: "not-numeric",
      }),
    ).rejects.toMatchObject({
      code: "github_repository_metadata_invalid",
      status: 400,
    });
    expect(prisma.gitHubInstallation.findUnique).not.toHaveBeenCalled();
    expect(api.listBranches).not.toHaveBeenCalled();
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
