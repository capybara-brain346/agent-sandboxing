import type { NextFunction, Request, RequestHandler, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "../../config";
import type { SessionClaims } from "../../types/auth.types";
import { ServiceError } from "../../shared/errors";

export const AUTH_COOKIE_NAME = "agent_sandboxing_session";
export const OAUTH_STATE_COOKIE_NAME = "agent_sandboxing_oauth_state";
export const OAUTH_SCOPES = ["read:user", "user:email", "repo"] as const;

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const secretKey = (secret: string): Uint8Array =>
  new TextEncoder().encode(secret);

const cookieValue = (request: Request, name: string): string | undefined => {
  const header = request.header("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const cookie = (
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string =>
  `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

const claimsFrom = (payload: Record<string, unknown>): SessionClaims => {
  if (
    typeof payload.sub !== "string" ||
    typeof payload.login !== "string" ||
    typeof payload.avatarUrl !== "string" ||
    (payload.email !== null && typeof payload.email !== "string") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  )
    throw new Error("Invalid session claims");
  return {
    sub: payload.sub,
    login: payload.login,
    avatarUrl: payload.avatarUrl,
    email: payload.email,
    iat: payload.iat,
    exp: payload.exp,
  };
};

export const signSessionToken = async (
  input: Omit<SessionClaims, "iat" | "exp">,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> =>
  new SignJWT({
    login: input.login,
    avatarUrl: input.avatarUrl,
    email: input.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(secret));

export const verifySessionToken = async (
  token: string,
  secret: string,
): Promise<SessionClaims> => {
  const result = await jwtVerify(token, secretKey(secret), {
    algorithms: ["HS256"],
  });
  return claimsFrom(result.payload);
};

export const createOAuthState = async (
  secret: string,
): Promise<{ state: string; token: string }> => {
  const state = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ state })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + OAUTH_STATE_MAX_AGE_SECONDS)
    .sign(secretKey(secret));
  return { state, token };
};

export const verifyOAuthState = async (
  token: string,
  expectedState: string,
  secret: string,
): Promise<boolean> => {
  try {
    const result = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
    });
    const state = result.payload.state;
    if (typeof state !== "string") return false;
    const actual = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
};

export const setSessionCookie = (
  response: Response,
  token: string,
  config: Pick<Config, "NODE_ENV">,
): void => {
  response.append(
    "Set-Cookie",
    cookie(
      AUTH_COOKIE_NAME,
      token,
      SESSION_MAX_AGE_SECONDS,
      config.NODE_ENV === "production",
    ),
  );
};

export const clearSessionCookie = (
  response: Response,
  config: Pick<Config, "NODE_ENV">,
): void => {
  response.append(
    "Set-Cookie",
    cookie(AUTH_COOKIE_NAME, "", 0, config.NODE_ENV === "production"),
  );
};

export const setOAuthStateCookie = (
  response: Response,
  token: string,
  config: Pick<Config, "NODE_ENV">,
): void => {
  response.append(
    "Set-Cookie",
    cookie(
      OAUTH_STATE_COOKIE_NAME,
      token,
      OAUTH_STATE_MAX_AGE_SECONDS,
      config.NODE_ENV === "production",
    ),
  );
};

export const clearOAuthStateCookie = (
  response: Response,
  config: Pick<Config, "NODE_ENV">,
): void => {
  response.append(
    "Set-Cookie",
    cookie(OAUTH_STATE_COOKIE_NAME, "", 0, config.NODE_ENV === "production"),
  );
};

export const requireAuth =
  (config: Config): RequestHandler =>
  async (request: Request, _response: Response, next: NextFunction) => {
    const token = cookieValue(request, AUTH_COOKIE_NAME);
    if (!token) {
      next(
        new ServiceError("auth_required", "Authentication is required", 401),
      );
      return;
    }
    try {
      request.user = await verifySessionToken(token, config.AUTH_COOKIE_SECRET);
      next();
    } catch {
      next(new ServiceError("auth_invalid", "Authentication is invalid", 401));
    }
  };

export const requireSameOrigin =
  (config: Config): RequestHandler =>
  (request: Request, _response: Response, next: NextFunction): void => {
    const origin = request.header("Origin") ?? request.header("Referer");
    let valid = false;
    if (origin) {
      try {
        valid = new URL(origin).origin === new URL(config.APP_BASE_URL).origin;
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      next(
        new ServiceError("csrf_invalid", "Request origin is not allowed", 403),
      );
      return;
    }
    next();
  };

export const sessionClaims = (request: Request): SessionClaims => {
  if (!request.user)
    throw new ServiceError("auth_required", "Authentication is required", 401);
  return request.user;
};

export const readCookie = (
  request: Request,
  name: string,
): string | undefined => cookieValue(request, name);
