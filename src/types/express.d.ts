declare global {
  namespace Express {
    interface AuthenticatedUser {
      sub: string;
      login: string;
      avatarUrl: string;
      email: string | null;
      iat: number;
      exp: number;
    }

    interface Request {
      id: string;
      user?: AuthenticatedUser;
    }
  }
}

export {};
