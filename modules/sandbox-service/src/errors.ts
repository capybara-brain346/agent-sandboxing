export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (code: string, message: string): ServiceError =>
  new ServiceError(code, message, 404);
