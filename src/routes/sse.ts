import type { Response } from "express";
import { ServiceError } from "../shared/errors";
import type { StreamEvent } from "../types/event.types";

export const parseSseCursor = (raw: string | undefined): number => {
  const cursor = Number(raw ?? "0");
  if (
    (raw !== undefined && raw.trim() === "") ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  )
    throw new ServiceError(
      "invalid_cursor",
      "Event cursor must be a non-negative integer",
    );
  return cursor;
};

export const writeSseEvent = (
  response: Pick<Response, "write">,
  event: StreamEvent,
): void => {
  response.write(
    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
};

export const startSseKeepalive = (
  response: Pick<Response, "write" | "writableEnded" | "destroyed">,
): ReturnType<typeof setInterval> => {
  const timer = setInterval(() => {
    if (!response.writableEnded && !response.destroyed)
      response.write(": keepalive\n\n");
  }, 15000);
  timer.unref();
  return timer;
};
