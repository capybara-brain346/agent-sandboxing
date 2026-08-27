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
      response.redirect("/repos?error=github_installation_cancelled");
      return;
    }
    try {
      await githubService.saveInstallation(
        sessionClaims(request).sub,
        installationId,
      );
      response.redirect("/repos");
    } catch (error) {
      response.redirect(
        `/repos?error=${encodeURIComponent(installationFailureCode(error))}`,
      );
    }
  },
);

githubRouter.get(
  "/github/repositories",
  requireAuth(githubConfig),
  async (request, response, next) => {
    try {
      response.json(
        await githubService.repositories(sessionClaims(request).sub),
      );
    } catch (error) {
      next(error);
    }
  },
);
