export type SessionClaims = {
  sub: string;
  login: string;
  avatarUrl: string;
  email: string | null;
  iat: number;
  exp: number;
};

export type GitHubOAuthUser = {
  githubUserId: string;
  login: string;
  avatarUrl: string;
  email: string | null;
};

export type OAuthToken = {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  tokenType: string;
  expiresAt?: Date;
  refreshTokenExpiresAt?: Date;
};
