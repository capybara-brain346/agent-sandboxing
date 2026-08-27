import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../src/shared/errors";
import {
  authConfig,
  authRouter,
  githubOAuthService,
} from "../src/routes/auth.routes";
import {
  AUTH_COOKIE_NAME,
  createOAuthState,
  OAUTH_STATE_COOKIE_NAME,
  signSessionToken,
} from "../src/services/auth/auth";
import { decryptToken, encryptToken } from "../src/services/auth/token-crypto";

const config = authConfig;
const user = {
  sub: "user_1",
  login: "octo",
  avatarUrl: "https://github.com/octo.png",
  email: "octo@example.test",
};

const makeApp = () => {
  const app = express();
  app.use(authRouter);
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const serviceError = error instanceof ServiceError ? error : null;
      response.status(serviceError?.status ?? 500).json({
        error: {
          code: serviceError?.code ?? "internal_error",
          message: serviceError?.message ?? "Internal server error",
        },
      });
    },
  );
  return app;
};

afterEach(() => vi.restoreAllMocks());

describe("auth routes", () => {
  it("requires authentication for auth/me", async () => {
    const response = await request(makeApp()).get("/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("auth_required");
  });

  it("returns verified session claims and clears logout cookie", async () => {
    const token = await signSessionToken(user, config.AUTH_COOKIE_SECRET);
    const cookie = `${AUTH_COOKIE_NAME}=${token}`;
    const me = await request(makeApp()).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject(user);

    const logout = await request(makeApp())
      .post("/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "http://localhost:3000");
    expect(logout.status).toBe(204);
    expect(logout.headers["set-cookie"][0]).toContain(
      `${AUTH_COOKIE_NAME}=; Max-Age=0`,
    );
  });

  it("rejects mutating requests without a same-origin header", async () => {
    const token = await signSessionToken(user, config.AUTH_COOKIE_SECRET);
    const response = await request(makeApp())
      .post("/auth/logout")
      .set("Cookie", `${AUTH_COOKIE_NAME}=${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("csrf_invalid");
  });

  it("starts OAuth with a signed state cookie", async () => {
    vi.spyOn(githubOAuthService, "authorizationUrl").mockReturnValue(
      "https://github.com/login/oauth/authorize?state=test",
    );
    const response = await request(makeApp()).get("/auth/github/start");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "https://github.com/login/oauth/authorize?state=test",
    );
    expect(response.headers["set-cookie"][0]).toContain(
      `${OAUTH_STATE_COOKIE_NAME}=`,
    );
  });

  it("rejects an OAuth callback with invalid state", async () => {
    const response = await request(makeApp()).get(
      "/auth/github/callback?code=code&state=state",
    );
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/login?error=auth_state_invalid");
  });

  it("sets an app session after a successful OAuth callback", async () => {
    const state = await createOAuthState(config.AUTH_COOKIE_SECRET);
    const token = await signSessionToken(user, config.AUTH_COOKIE_SECRET);
    vi.spyOn(githubOAuthService, "callback").mockResolvedValue({
      token,
      claims: {
        ...user,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 604800,
      },
    });
    const response = await request(makeApp())
      .get(`/auth/github/callback?code=code&state=${state.state}`)
      .set("Cookie", `${OAUTH_STATE_COOKIE_NAME}=${state.token}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/repos");
    expect(response.headers["set-cookie"].join(";")).toContain(
      `${AUTH_COOKIE_NAME}=`,
    );
  });
});

describe("token encryption", () => {
  it("round trips encrypted tokens without storing plaintext", () => {
    const encrypted = encryptToken(
      "gho_secret",
      config.AUTH_TOKEN_ENCRYPTION_KEY,
    );
    expect(encrypted.ciphertext).not.toContain("gho_secret");
    expect(decryptToken(encrypted, config.AUTH_TOKEN_ENCRYPTION_KEY)).toBe(
      "gho_secret",
    );
  });

  it("rejects expired app session tokens", async () => {
    const token = await signSessionToken(
      user,
      config.AUTH_COOKIE_SECRET,
      Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60,
    );
    await expect(
      request(makeApp())
        .get("/auth/me")
        .set("Cookie", `${AUTH_COOKIE_NAME}=${token}`),
    ).resolves.toMatchObject({ status: 401 });
  });
});
