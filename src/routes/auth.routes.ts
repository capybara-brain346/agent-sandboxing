import { Router, type Request, type Response } from "express";
import { loadConfig } from "../config";
import { ServiceError } from "../shared/errors";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  createOAuthState,
  OAUTH_STATE_COOKIE_NAME,
  readCookie,
  requireAuth,
  requireSameOrigin,
  sessionClaims,
  setOAuthStateCookie,
  setSessionCookie,
  verifyOAuthState,
} from "../services/auth/auth";
import { GitHubOAuthService } from "../services/auth/github-oauth";
import { prisma } from "../db/prisma";

export const authConfig = loadConfig();
export const githubOAuthService = new GitHubOAuthService(prisma, authConfig);
export const authRouter = Router();

const queryString = (request: Request, key: string): string | undefined =>
  typeof request.query[key] === "string" ? request.query[key] : undefined;

const frontendUrl = (path: string): string =>
  new URL(path, authConfig.APP_BASE_URL).toString();

const redirectFailure = (
  response: Response,
  path: "/login" | "/repos",
  code: string,
): void => {
  const allowed = new Set([
    "auth_state_invalid",
    "github_oauth_failed",
    "github_reconnect_required",
    "github_installation_failed",
    "github_installation_not_allowed",
    "github_installation_cancelled",
  ]);
  const safeCode = allowed.has(code) ? code : "github_oauth_failed";
  response.redirect(
    frontendUrl(`${path}?error=${encodeURIComponent(safeCode)}`),
  );
};

authRouter.get("/auth/github/start", async (_request, response, next) => {
  try {
    const state = await createOAuthState(authConfig.AUTH_COOKIE_SECRET);
    setOAuthStateCookie(response, state.token, authConfig);
    response.redirect(githubOAuthService.authorizationUrl(state.state));
  } catch (error) {
    next(error);
  }
});

authRouter.get("/auth/github/callback", async (request, response) => {
  const state = queryString(request, "state");
  const code = queryString(request, "code");
  const stateCookie = readCookie(request, OAUTH_STATE_COOKIE_NAME);
  clearOAuthStateCookie(response, authConfig);
  if (
    !state ||
    !code ||
    !stateCookie ||
    !(await verifyOAuthState(stateCookie, state, authConfig.AUTH_COOKIE_SECRET))
  ) {
    redirectFailure(response, "/login", "auth_state_invalid");
    return;
  }
  try {
    const result = await githubOAuthService.callback(code);
    setSessionCookie(response, result.token, authConfig);
    response.redirect(frontendUrl("/repos"));
  } catch (error) {
    redirectFailure(
      response,
      "/login",
      error instanceof ServiceError ? error.code : "github_oauth_failed",
    );
  }
});

authRouter.post(
  "/auth/logout",
  requireAuth(authConfig),
  requireSameOrigin(authConfig),
  (_request, response) => {
    clearSessionCookie(response, authConfig);
    response.status(204).end();
  },
);

authRouter.get("/auth/me", requireAuth(authConfig), (request, response) =>
  response.json(sessionClaims(request)),
);
