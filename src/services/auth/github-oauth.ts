import { OAuthApp } from "@octokit/oauth-app";
import { Octokit } from "@octokit/rest";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../../config";
import { ServiceError } from "../../shared/errors";
import { encryptToken } from "./token-crypto";
import { OAUTH_SCOPES, signSessionToken } from "./auth";
import type {
  GitHubOAuthUser,
  OAuthToken,
  SessionClaims,
} from "../../types/auth.types";

export type OAuthProvider = {
  authorizationUrl(state: string, redirectUrl: string): string;
  exchangeCode(code: string, redirectUrl: string): Promise<OAuthToken>;
  getUser(accessToken: string): Promise<GitHubOAuthUser>;
};

const dateFrom = (value: unknown): Date | undefined => {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

class OctokitOAuthProvider implements OAuthProvider {
  private readonly app: OAuthApp;

  constructor(private readonly config: Config) {
    this.app = new OAuthApp({
      clientType: "oauth-app",
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    });
  }

  authorizationUrl(state: string, redirectUrl: string): string {
    return this.app.getWebFlowAuthorizationUrl({
      scopes: [...OAUTH_SCOPES],
      state,
      redirectUrl,
    }).url;
  }

  async exchangeCode(code: string, redirectUrl: string): Promise<OAuthToken> {
    const result = await this.app.createToken({
      code,
      redirectUrl,
    });
    const authentication = result.authentication as {
      token: string;
      scopes?: string[];
      refreshToken?: string;
      expiresAt?: string;
      refreshTokenExpiresAt?: string;
    };
    if (!authentication.token) throw new Error("OAuth token was missing");
    const token: OAuthToken = {
      accessToken: authentication.token,
      scope: authentication.scopes?.join(" ") ?? OAUTH_SCOPES.join(" "),
      tokenType: "bearer",
    };
    if (authentication.refreshToken)
      token.refreshToken = authentication.refreshToken;
    const expiresAt = dateFrom(authentication.expiresAt);
    if (expiresAt) token.expiresAt = expiresAt;
    const refreshTokenExpiresAt = dateFrom(
      authentication.refreshTokenExpiresAt,
    );
    if (refreshTokenExpiresAt)
      token.refreshTokenExpiresAt = refreshTokenExpiresAt;
    return token;
  }

  async getUser(accessToken: string): Promise<GitHubOAuthUser> {
    const octokit = new Octokit({ auth: accessToken });
    const [{ data: user }, { data: emails }] = await Promise.all([
      octokit.rest.users.getAuthenticated(),
      octokit.rest.users.listEmailsForAuthenticatedUser({ per_page: 100 }),
    ]);
    const primaryEmail = emails.find(
      (email) => email.primary && email.verified,
    );
    return {
      githubUserId: String(user.id),
      login: user.login,
      avatarUrl: user.avatar_url,
      email: primaryEmail?.email ?? null,
    };
  }
}

export class GitHubOAuthService {
  private readonly provider: OAuthProvider;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Config,
    provider?: OAuthProvider,
  ) {
    this.provider = provider ?? new OctokitOAuthProvider(config);
  }

  authorizationUrl(state: string): string {
    return this.provider.authorizationUrl(
      state,
      this.config.GITHUB_CALLBACK_URL,
    );
  }

  async callback(
    code: string,
  ): Promise<{ token: string; claims: SessionClaims }> {
    try {
      const token = await this.provider.exchangeCode(
        code,
        this.config.GITHUB_CALLBACK_URL,
      );
      const githubUser = await this.provider.getUser(token.accessToken);
      const access = encryptToken(
        token.accessToken,
        this.config.AUTH_TOKEN_ENCRYPTION_KEY,
      );
      const refresh = token.refreshToken
        ? encryptToken(
            token.refreshToken,
            this.config.AUTH_TOKEN_ENCRYPTION_KEY,
          )
        : null;
      const user = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.user.upsert({
          where: { githubUserId: githubUser.githubUserId },
          create: {
            githubUserId: githubUser.githubUserId,
            login: githubUser.login,
            avatarUrl: githubUser.avatarUrl,
            email: githubUser.email,
          },
          update: {
            login: githubUser.login,
            avatarUrl: githubUser.avatarUrl,
            email: githubUser.email,
          },
        });
        await tx.gitHubOAuthToken.upsert({
          where: { userId: saved.id },
          create: {
            userId: saved.id,
            accessTokenCiphertext: access.ciphertext,
            accessTokenIv: access.iv,
            accessTokenTag: access.tag,
            refreshTokenCiphertext: refresh?.ciphertext ?? null,
            refreshTokenIv: refresh?.iv ?? null,
            refreshTokenTag: refresh?.tag ?? null,
            scope: token.scope,
            tokenType: token.tokenType,
            expiresAt: token.expiresAt ?? null,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
          },
          update: {
            accessTokenCiphertext: access.ciphertext,
            accessTokenIv: access.iv,
            accessTokenTag: access.tag,
            refreshTokenCiphertext: refresh?.ciphertext ?? null,
            refreshTokenIv: refresh?.iv ?? null,
            refreshTokenTag: refresh?.tag ?? null,
            scope: token.scope,
            tokenType: token.tokenType,
            expiresAt: token.expiresAt ?? null,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
          },
        });
        return saved;
      });
      const claims = {
        sub: user.id,
        login: user.login,
        avatarUrl: user.avatarUrl,
        email: user.email,
      };
      const iat = Math.floor(Date.now() / 1000);
      return {
        claims: {
          ...claims,
          iat,
          exp: iat + 7 * 24 * 60 * 60,
        },
        token: await signSessionToken(
          claims,
          this.config.AUTH_COOKIE_SECRET,
          iat,
        ),
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "github_oauth_failed",
        "GitHub sign-in failed",
        502,
      );
    }
  }
}

export { OctokitOAuthProvider };
