import { Router } from "express";
import { loadConfig } from "../config";
import { prisma } from "../db/prisma";
import { ServiceError } from "../shared/errors";
import { requireAuth, sessionClaims } from "../services/auth/auth";
import { GitHubService } from "../services/github/github";

export const githubConfig = loadConfig();
export const githubService = new GitHubService(prisma, githubConfig);
export const githubRouter = Router();

const queryString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const queryInt = (value: unknown): number | undefined => {
  const text = queryString(value);
  if (!text || !/^\d+$/.test(text)) return undefined;
  return Number(text);
};

const frontendUrl = (path: string): string =>
  new URL(path, githubConfig.APP_BASE_URL).toString();

const installationFailureCode = (error: unknown): string => {
  if (!(error instanceof ServiceError)) return "github_installation_failed";
  if (
    error.code === "github_installation_not_allowed" ||
    error.code === "auth_invalid"
  )
    return error.code;
  return "github_installation_failed";
};

githubRouter.get(
  "/github/install",
  requireAuth(githubConfig),
  (_request, response) => response.redirect(githubService.installUrl()),
);

githubRouter.get(
  "/github/install/callback",
  requireAuth(githubConfig),
  async (request, response) => {
    const installationId = queryString(request.query.installation_id);
    if (!installationId || !/^\d+$/.test(installationId)) {
      response.redirect(
        frontendUrl("/repos?error=github_installation_cancelled"),
      );
      return;
    }
    try {
      await githubService.saveInstallation(
        sessionClaims(request).sub,
        installationId,
      );
      response.redirect(frontendUrl("/repos"));
    } catch (error) {
      response.redirect(
        frontendUrl(
          `/repos?error=${encodeURIComponent(installationFailureCode(error))}`,
        ),
      );
    }
  },
);

githubRouter.get(
  "/github/repositories",
  requireAuth(githubConfig),
  async (request, response, next) => {
    try {
      const userId = sessionClaims(request).sub;
      const forceRefresh = queryString(request.query.forceRefresh) === "true";
      const cursor = queryString(request.query.cursor);
      const limit = queryInt(request.query.limit);
      response.json(
        await githubService.repositories(userId, {
          ...(forceRefresh ? { forceRefresh: true } : {}),
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

githubRouter.get(
  "/github/repositories/:repoId/branches",
  requireAuth(githubConfig),
  async (request, response, next) => {
    try {
      const repoId = request.params.repoId;
      if (typeof repoId !== "string")
        throw new ServiceError(
          "github_repository_not_found",
          "Repository was not found",
          404,
        );
      response.json(
        await githubService.branches(sessionClaims(request).sub, {
          repoId,
          owner: queryString(request.query.owner),
          name: queryString(request.query.name),
          installationId: queryString(request.query.installationId),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);
