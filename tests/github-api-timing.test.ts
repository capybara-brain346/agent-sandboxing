import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appRequest: vi.fn(),
  getInstallationOctokit: vi.fn(),
  installationIterator: vi.fn(),
  paginate: vi.fn(),
}));

vi.mock("@octokit/app", () => ({
  App: vi.fn(() => ({
    octokit: { request: mocks.appRequest },
    getInstallationOctokit: mocks.getInstallationOctokit,
    eachRepository: { iterator: mocks.installationIterator },
  })),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    paginate: mocks.paginate,
    rest: { repos: { listForAuthenticatedUser: vi.fn() } },
  })),
}));

import { loadConfig } from "../src/config";
import { logger } from "../src/logger";
import { OctokitGitHubApi } from "../src/services/github/github";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
});

const repository = {
  id: 1,
  owner: { id: 2, login: "octo", type: "User" },
  name: "repo",
  full_name: "octo/repo",
  private: true,
  default_branch: "main",
};

const timingFields = (
  debug: ReturnType<typeof vi.spyOn>,
  operation: string,
): Record<string, unknown> => {
  const call = debug.mock.calls.find(
    ([event, fields]) =>
      event === "github_api_call_timing" &&
      (fields as Record<string, unknown>).operation === operation,
  );
  expect(call).toBeDefined();
  const fields = call?.[1] as Record<string, unknown>;
  expect(fields.durationMs).toEqual(expect.any(Number));
  return fields;
};

describe("OctokitGitHubApi timing", () => {
  beforeEach(() => {
    mocks.appRequest.mockReset();
    mocks.getInstallationOctokit.mockReset();
    mocks.installationIterator.mockReset();
    mocks.paginate.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("logs safe timing and pagination fields for GitHub operations", async () => {
    const branchRequest = vi.fn().mockResolvedValue({
      data: [{ name: "main", commit: { sha: "abc" }, protected: true }],
    });
    const auth = vi.fn().mockResolvedValue({ token: "installation-token" });
    mocks.appRequest.mockResolvedValue({
      data: [{ id: 10, account: { id: 2, login: "octo", type: "User" } }],
    });
    mocks.getInstallationOctokit.mockResolvedValue({
      request: branchRequest,
      auth,
    });
    mocks.paginate.mockImplementation(async (_route, _parameters, map) =>
      map({ data: [repository] }, vi.fn()),
    );
    mocks.installationIterator.mockReturnValue(
      (async function* () {
        yield { repository };
      })(),
    );
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const api = new OctokitGitHubApi(config);

    await api.listAppInstallations();
    await api.listOAuthRepositories("oauth-token");
    await api.createInstallationToken("10");
    await api.listInstallationRepositories("10");
    await api.listBranches("10", "octo", "repo");

    expect(debug).toHaveBeenCalledTimes(5);
    expect(timingFields(debug, "listAppInstallations")).toMatchObject({
      pageCount: 1,
      resultCount: 1,
    });
    expect(timingFields(debug, "listOAuthRepositories")).toMatchObject({
      pageCount: 1,
      resultCount: 1,
    });
    expect(timingFields(debug, "createInstallationToken")).toMatchObject({
      installationId: "10",
    });
    expect(timingFields(debug, "listInstallationRepositories")).toMatchObject({
      installationId: "10",
      resultCount: 1,
    });
    expect(timingFields(debug, "listBranches")).toMatchObject({
      installationId: "10",
      owner: "octo",
      repo: "repo",
      pageCount: 1,
      resultCount: 1,
    });
    expect(debug.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: expect.anything() }),
      ]),
    );
  });

  it("logs timing when a GitHub operation fails", async () => {
    const error = new Error("request failed");
    mocks.getInstallationOctokit.mockResolvedValue({
      request: vi.fn().mockRejectedValue(error),
    });
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const api = new OctokitGitHubApi(config);

    await expect(api.listBranches("10", "octo", "repo")).rejects.toBe(error);

    expect(timingFields(debug, "listBranches")).toMatchObject({
      installationId: "10",
      owner: "octo",
      repo: "repo",
      pageCount: 1,
      resultCount: 0,
    });
  });
});
