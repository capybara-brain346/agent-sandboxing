import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { githubRouter, githubService } from "../src/routes/github.routes";
import { AUTH_COOKIE_NAME, signSessionToken } from "../src/services/auth/auth";
import { ServiceError } from "../src/shared/errors";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
});
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

  it("returns repository and branch metadata", async () => {
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
          branches: [{ name: "main", sha: "abc", protected: true }],
        },
      ],
      installUrl: config.GITHUB_APP_INSTALL_URL,
    });
    const response = await request(makeApp())
      .get("/github/repositories")
      .set("Cookie", authCookie);
    expect(response.status).toBe(200);
    expect(response.body.repositories[0].branches[0]).toEqual({
      name: "main",
      sha: "abc",
      protected: true,
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
    expect(response.headers.location).toBe("/repos");
    expect(save).toHaveBeenCalledWith("user_1", "10");
  });

  it("returns a safe cancellation redirect for a malformed installation callback", async () => {
    const response = await request(makeApp())
      .get("/github/install/callback?setup_action=cancel")
      .set("Cookie", authCookie);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "/repos?error=github_installation_cancelled",
    );
  });
});
