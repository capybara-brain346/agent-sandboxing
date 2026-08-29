import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  githubConfig,
  githubRouter,
  githubService,
} from "../src/routes/github.routes";
import { AUTH_COOKIE_NAME, signSessionToken } from "../src/services/auth/auth";
import { ServiceError } from "../src/shared/errors";

const config = githubConfig;
const authCookie = `${AUTH_COOKIE_NAME}=${await signSessionToken(
  {
    sub: "user_1",
    login: "octo",
    avatarUrl: "https://github.com/octo.png",
    email: null,
  },
  config.AUTH_COOKIE_SECRET,
)}`;

const makeApp = () => {
  const app = express();
  app.use(githubRouter);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const serviceError = error instanceof ServiceError ? error : null;
      response.status(serviceError?.status ?? 500).json({
        error: { code: serviceError?.code ?? "internal_error" },
      });
    },
  );
  return app;
};

afterEach(() => vi.restoreAllMocks());

describe("GitHub routes", () => {
  it("requires auth before redirecting to install", async () => {
    const response = await request(makeApp()).get("/github/install");
    expect(response.status).toBe(401);
  });

  it("redirects an authenticated user to the configured app install URL", async () => {
    const response = await request(makeApp())
      .get("/github/install")
      .set("Cookie", authCookie);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(config.GITHUB_APP_INSTALL_URL);
  });

  it("returns repository metadata without eager branch loading", async () => {
    vi.spyOn(githubService, "repositories").mockResolvedValue({
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
          defaultBranch: "main",
          installationId: "10",
          branches: [],
        },
      ],
      installUrl: config.GITHUB_APP_INSTALL_URL,
    });
    const response = await request(makeApp())
      .get("/github/repositories")
      .set("Cookie", authCookie);
    expect(response.status).toBe(200);
    expect(response.body.repositories[0].branches).toEqual([]);
  });

  it("passes repository refresh requests through to the service", async () => {
    const repositories = vi
      .spyOn(githubService, "repositories")
      .mockResolvedValue({
        installations: [],
        repositories: [],
        installUrl: config.GITHUB_APP_INSTALL_URL,
      });
    const response = await request(makeApp())
      .get("/github/repositories?forceRefresh=true")
      .set("Cookie", authCookie);
    expect(response.status).toBe(200);
    expect(repositories).toHaveBeenCalledWith("user_1", {
      forceRefresh: true,
    });
  });

  it("returns branches for one repository", async () => {
    const branches = vi
      .spyOn(githubService, "branches")
      .mockResolvedValue([{ name: "main", sha: "abc", protected: true }]);
    const response = await request(makeApp())
      .get(
        "/github/repositories/1/branches?owner=octo&name=repo&installationId=10",
      )
      .set("Cookie", authCookie);
    expect(response.status).toBe(200);
    expect(response.body[0]).toEqual({
      name: "main",
      sha: "abc",
      protected: true,
    });
    expect(branches).toHaveBeenCalledWith("user_1", {
      repoId: "1",
      owner: "octo",
      name: "repo",
      installationId: "10",
    });
  });

  it("connects a personal installation and redirects back to repos", async () => {
    const save = vi.spyOn(githubService, "saveInstallation").mockResolvedValue({
      installationId: "10",
      accountLogin: "octo",
      accountType: "user",
    });
    const response = await request(makeApp())
      .get("/github/install/callback?installation_id=10")
      .set("Cookie", authCookie);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${config.APP_BASE_URL}/repos`);
    expect(save).toHaveBeenCalledWith("user_1", "10");
  });

  it("returns a safe cancellation redirect for a malformed installation callback", async () => {
    const response = await request(makeApp())
      .get("/github/install/callback?setup_action=cancel")
      .set("Cookie", authCookie);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      `${config.APP_BASE_URL}/repos?error=github_installation_cancelled`,
    );
  });
});
