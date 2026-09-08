import {
  AUTH_COOKIE_NAME,
  signSessionToken,
} from "../../src/services/auth/auth";
import type {
  ChatMessage,
  ChatSession,
  CreateMessageResponse,
  SessionResult,
} from "../../src/types/chat.types";
import type { PublicEvent } from "../../src/types/event.types";
import type {
  ChatEvidence,
  SseEvidence,
  SweBenchTask,
  TaskFixture,
} from "./types";

type EvaluationAuth = {
  secret: string;
  userId: string;
  login: string;
  avatarUrl: string;
  email: string | null;
};

type EventCollection = {
  status: number;
  contentType: string;
  stop: () => Promise<PublicEvent[]>;
};

export class EvalHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "EvalHttpError";
  }
}

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const safeErrorPayload = (
  value: unknown,
): { code: string | null; message: string | null } => {
  if (!value || typeof value !== "object") return { code: null, message: null };
  const error = "error" in value ? value.error : value;
  if (!error || typeof error !== "object") return { code: null, message: null };
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : null,
    message:
      "message" in error && typeof error.message === "string"
        ? error.message
        : null,
  };
};

const parseEvent = (value: string): PublicEvent | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    if (!("sequence" in parsed) || typeof parsed.sequence !== "number")
      return null;
    return parsed as PublicEvent;
  } catch {
    return null;
  }
};

const parseSseChunk = (
  buffer: string,
): { events: PublicEvent[]; remainder: string } => {
  const records = buffer.split("\n\n");
  const remainder = records.pop() ?? "";
  const events: PublicEvent[] = [];
  for (const record of records) {
    const data = record
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    const event = data ? parseEvent(data) : null;
    if (event) events.push(event);
  }
  return { events, remainder };
};

const collectEvents = async (
  response: Response,
  controller: AbortController,
): Promise<EventCollection> => {
  if (!response.body) throw new Error("session events response had no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: PublicEvent[] = [];
  const read = (async (): Promise<void> => {
    let buffer = "";
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.remainder;
        events.push(...parsed.events);
      }
      const parsed = parseSseChunk(`${buffer}${decoder.decode()}\n\n`);
      events.push(...parsed.events);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    stop: async () => {
      controller.abort();
      await read.catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });
      return events;
    },
  };
};

const promptForTask = (task: SweBenchTask): string =>
  [
    `SWE-bench task: ${task.instance_id}`,
    `Repository: ${task.repo}`,
    `Base commit: ${task.base_commit}`,
    "",
    task.problem_statement,
  ].join("\n");

export const evaluationAuthFromEnv = (): EvaluationAuth => {
  const secret =
    process.env.SWE_BENCH_AUTH_COOKIE_SECRET ?? process.env.AUTH_COOKIE_SECRET;
  if (!secret)
    throw new Error(
      "SWE_BENCH_AUTH_COOKIE_SECRET or AUTH_COOKIE_SECRET is required",
    );
  return {
    secret,
    userId: process.env.SWE_BENCH_AUTH_USER_ID ?? "swe-bench-lite-user",
    login: process.env.SWE_BENCH_AUTH_LOGIN ?? "swe-bench-lite",
    avatarUrl:
      process.env.SWE_BENCH_AUTH_AVATAR_URL ??
      "https://example.invalid/swe-bench-lite.png",
    email: process.env.SWE_BENCH_AUTH_EMAIL ?? "swe-bench-lite@example.invalid",
  };
};

export class EvalHttpClient {
  readonly baseUrl: string;
  readonly cookie: string;
  readonly origin: string;
  readonly pollIntervalMs: number;
  lastSessionId: string | undefined;
  lastSandboxId: string | undefined;

  private constructor(baseUrl: string, cookie: string, pollIntervalMs: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookie = cookie;
    this.origin = new URL(this.baseUrl).origin;
    this.pollIntervalMs = pollIntervalMs;
    this.lastSessionId = undefined;
    this.lastSandboxId = undefined;
  }

  static async create(
    baseUrl: string,
    auth: EvaluationAuth,
    pollIntervalMs = Number(process.env.SWE_BENCH_POLL_INTERVAL_MS ?? 500),
  ): Promise<EvalHttpClient> {
    if (auth.secret.length < 32)
      throw new Error("evaluation auth secret is too short");
    const token = await signSessionToken(
      {
        sub: auth.userId,
        login: auth.login,
        avatarUrl: auth.avatarUrl,
        email: auth.email,
      },
      auth.secret,
    );
    return new EvalHttpClient(
      baseUrl,
      `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
      pollIntervalMs,
    );
  }

  private async requestJson<T>(
    method: string,
    endpoint: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: this.cookie,
        Origin: this.origin,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const safe = safeErrorPayload(payload);
      throw new EvalHttpError(
        safe.message ?? `HTTP ${response.status} from ${method} ${endpoint}`,
        response.status,
        safe.code,
      );
    }
    return payload as T;
  }

  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new EvalHttpError(
        `API health returned ${response.status}`,
        response.status,
      );
    return payload as { status: string };
  }

  private async startEvents(sessionId: string): Promise<EventCollection> {
    const controller = new AbortController();
    const response = await fetch(
      `${this.baseUrl}/chat-sessions/${encodeURIComponent(sessionId)}/events?after=0`,
      {
        headers: {
          Accept: "text/event-stream",
          Cookie: this.cookie,
          Origin: this.origin,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new EvalHttpError(
        `session events returned ${response.status}`,
        response.status,
      );
    return collectEvents(response, controller);
  }

  private async getSession(sessionId: string): Promise<ChatSession> {
    return this.requestJson<ChatSession>(
      "GET",
      `/chat-sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async recoverSandboxId(): Promise<string | undefined> {
    if (!this.lastSessionId) return this.lastSandboxId;
    const session = await this.getSession(this.lastSessionId);
    this.lastSandboxId = session.sandboxId ?? this.lastSandboxId;
    return this.lastSandboxId;
  }

  private async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const page = await this.requestJson<{ items: ChatMessage[] }>(
      "GET",
      `/chat-sessions/${encodeURIComponent(sessionId)}/messages?limit=100`,
    );
    return page.items;
  }

  private async getResult(sessionId: string): Promise<SessionResult | null> {
    try {
      return await this.requestJson<SessionResult>(
        "GET",
        `/chat-sessions/${encodeURIComponent(sessionId)}/result`,
      );
    } catch (error) {
      if (error instanceof EvalHttpError && error.status === 404) return null;
      throw error;
    }
  }

  async runSession(
    task: SweBenchTask,
    fixture: TaskFixture,
    image: string,
  ): Promise<ChatEvidence> {
    const startedAt = Date.now();
    const session = await this.requestJson<ChatSession>(
      "POST",
      "/chat-sessions",
      {
        repo: { source: "fixture", ref: fixture.containerRepoRef },
        title: `SWE-bench Lite ${task.instance_id}`,
        image,
      },
    );
    this.lastSessionId = session.chatSessionId;
    const stream = await this.startEvents(session.chatSessionId);
    let stopped = false;
    const stopStream = async (): Promise<PublicEvent[]> => {
      if (stopped) return [];
      stopped = true;
      return stream.stop();
    };
    try {
      const message = await this.requestJson<CreateMessageResponse>(
        "POST",
        `/chat-sessions/${encodeURIComponent(session.chatSessionId)}/messages`,
        { content: promptForTask(task) },
      );
      const deadline =
        Date.now() +
        Number(process.env.SWE_BENCH_ATTEMPT_TIMEOUT_MS ?? 1_800_000);
      let latestSession = session;
      let latestMessages: ChatMessage[] = [];
      let latestResult: SessionResult | null = null;
      while (Date.now() < deadline) {
        latestSession = await this.getSession(session.chatSessionId);
        this.lastSandboxId = latestSession.sandboxId ?? this.lastSandboxId;
        latestMessages = await this.getMessages(session.chatSessionId);
        latestResult = await this.getResult(session.chatSessionId);
        const processed = latestMessages.find(
          (candidate) => candidate.messageId === message.message.messageId,
        );
        if (
          latestResult?.messageId === message.message.messageId &&
          processed?.processingStatus &&
          ["completed", "failed", "cancelled"].includes(
            processed.processingStatus,
          )
        )
          break;
        await sleep(this.pollIntervalMs);
      }
      const events = await stopStream();
      if (!latestResult || latestResult.messageId !== message.message.messageId)
        throw new Error(
          `message ${message.message.messageId} did not reach a terminal result`,
        );
      const completedMessage = latestMessages.find(
        (candidate) => candidate.messageId === message.message.messageId,
      );
      if (!completedMessage)
        throw new Error(
          "terminal message was not returned by the messages endpoint",
        );
      const sse: SseEvidence = {
        status: stream.status,
        contentType: stream.contentType,
        events,
      };
      return {
        session: latestSession,
        message: completedMessage,
        messages: latestMessages,
        result: latestResult,
        sse,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (!stopped) await stopStream().catch(() => undefined);
    }
  }
}
