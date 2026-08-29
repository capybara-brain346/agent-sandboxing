import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useParams } from "react-router-dom";
import { Tabs } from "radix-ui";
import { GripVertical, Ban } from "lucide-react";
import {
  ApiError,
  cancelCurrentMessage,
  getChatSession,
  getCurrentPullRequest,
  getSessionResult,
  listMessages,
  sendMessage,
} from "@/api/client";
import { useEventStream } from "@/api/useEventStream";
import type {
  ChatMessage,
  ChatSession,
  PullRequestMetadata,
  SessionResult,
} from "@/api/types";
import { TERMINAL_STATUSES } from "@/api/types";
import {
  DiffTable,
  MessageBubble,
  parseDiff,
  PullRequestCard,
  PromptBar,
  StatusPill,
  TimelineRow,
  ThinkingBlock,
} from "@/components/ai";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActiveSession } from "@/context/ActiveSessionContext";
import { cn } from "@/lib/utils";

const SESSION_REFRESH_EVENT_TYPES = new Set([
  "message_created",
  "message_processing_requested",
  "message_processing_started",
  "message_processing_completed",
  "message_processing_failed",
  "message_processing_cancelled",
  "message_result_ready",
]);

const PR_EVENT_TYPES = new Set([
  "pull_request_creation_started",
  "pull_request_created",
  "pull_request_updated",
  "pull_request_closed",
  "pull_request_reopened",
  "pull_request_failed",
]);

const pullRequestFailure = (value: unknown): PullRequestMetadata["failure"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" &&
    typeof candidate.message === "string"
    ? { code: candidate.code, message: candidate.message }
    : null;
};

const applyPullRequestFailure = (
  pullRequest: PullRequestMetadata | null,
  failure: NonNullable<PullRequestMetadata["failure"]>,
): PullRequestMetadata | null =>
  pullRequest ? { ...pullRequest, failure } : null;

const pullRequestFromEvents = (
  events: ReturnType<typeof useEventStream>["events"],
): PullRequestMetadata | null => {
  let current: PullRequestMetadata | null = null;
  for (const event of events) {
    if (!PR_EVENT_TYPES.has(event.type)) continue;
    const eventFailure =
      event.type === "pull_request_failed"
        ? pullRequestFailure(event.payload.failure)
        : null;
    const candidate = event.payload.pull_request;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      if (eventFailure)
        current = applyPullRequestFailure(current, eventFailure);
      continue;
    }
    const value = candidate as Record<string, unknown>;
    if (
      value.provider !== "github" ||
      typeof value.branch !== "string" ||
      typeof value.baseBranch !== "string" ||
      typeof value.title !== "string" ||
      typeof value.status !== "string" ||
      typeof value.draft !== "boolean"
    )
      continue;
    const failure = pullRequestFailure(value.failure) ?? eventFailure;
    current = {
      provider: "github",
      url: typeof value.url === "string" ? value.url : null,
      number: typeof value.number === "number" ? value.number : null,
      branch: value.branch,
      baseBranch: value.baseBranch,
      title: value.title,
      status: value.status as PullRequestMetadata["status"],
      draft: value.draft,
      failure,
    };
  }
  return current;
};

const TABS = [
  { id: "timeline", label: "Timeline" },
  { id: "files", label: "Changed files" },
  { id: "diff", label: "Diff" },
  { id: "pr", label: "Pull request" },
] as const;

const INSPECTOR_MIN_WIDTH = 340;
const INSPECTOR_MAX_WIDTH = 720;
const INSPECTOR_DEFAULT_WIDTH = 420;

const ThreadPane = ({
  messages,
  pending,
  pendingEvents,
}: {
  messages: ChatMessage[];
  pending: boolean;
  pendingEvents: ReturnType<typeof useEventStream>["events"];
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 32;
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, pendingEvents]);

  if (messages.length === 0 && !pending) {
    return (
      <p className="flex-1 py-10 text-center text-sm text-fg-subtle">
        Send a message to start working in this repo.
      </p>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-3 overflow-y-auto"
    >
      {messages.map((message) => (
        <MessageBubble key={message.messageId} message={message} />
      ))}
      {pending && (
        <div className="self-start">
          <ThinkingBlock events={pendingEvents} active />
        </div>
      )}
    </div>
  );
};

const ProcessingPanel = ({
  message,
  sessionId,
  baseBranch,
  events,
  connectionError,
  result,
  pullRequest,
  resultError,
  cancelling,
  onCancel,
  onPullRequest,
}: {
  message: ChatMessage;
  sessionId: string;
  baseBranch: string;
  events: ReturnType<typeof useEventStream>["events"];
  connectionError: boolean;
  result: SessionResult | null;
  pullRequest: PullRequestMetadata | null;
  resultError: string | null;
  cancelling: boolean;
  onCancel: () => void;
  onPullRequest: (pullRequest: PullRequestMetadata | null) => void;
}) => {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("timeline");
  const isTerminal =
    message.processingStatus !== null &&
    TERMINAL_STATUSES.has(message.processingStatus);
  const files = useMemo(() => (result ? parseDiff(result.diff) : []), [result]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 32;
  };

  useEffect(() => {
    if (tab !== "timeline") return;
    const el = bodyRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, tab]);

  useEffect(() => {
    if (tab === "timeline") stickToBottomRef.current = true;
  }, [tab]);

  useEffect(() => {
    if (tab !== "pr") return;
    let cancelled = false;
    getCurrentPullRequest(sessionId)
      .then((next) => {
        if (!cancelled) onPullRequest(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [onPullRequest, sessionId, tab]);

  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(next) => setTab(next as (typeof TABS)[number]["id"])}
      className="flex h-full flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs text-fg-muted">
            {message.messageId}
          </span>
          {message.processingStatus && (
            <StatusPill status={message.processingStatus} size="sm" />
          )}
        </div>
        {!isTerminal && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
          >
            <Ban className="size-3.5" />
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>

      <Tabs.List className="flex shrink-0 gap-1 border-b border-border-subtle px-2">
        {TABS.map((item) => (
          <Tabs.Trigger
            key={item.id}
            value={item.id}
            className={cn(
              "border-b-2 border-transparent px-2 py-2 text-xs font-medium text-fg-muted transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand",
              "data-[state=active]:border-brand data-[state=active]:text-fg",
            )}
          >
            {item.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <div className="flex-1 overflow-hidden">
        {connectionError && (
          <div className="px-3 pt-2">
            <Alert variant="warning">
              Event stream disconnected, retrying…
            </Alert>
          </div>
        )}
        {message.failure && (
          <div className="px-3 pt-2">
            <Alert variant="error">
              {message.failure.code}: {message.failure.message}
            </Alert>
          </div>
        )}

        <Tabs.Content
          value="timeline"
          ref={bodyRef}
          onScroll={handleBodyScroll}
          className="h-full overflow-y-auto"
        >
          {events.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              Waiting for activity…
            </p>
          ) : (
            <ol>
              {events.map((event, index) => (
                <TimelineRow
                  key={event.id}
                  event={event}
                  previousEvent={events[index - 1]}
                />
              ))}
            </ol>
          )}
        </Tabs.Content>

        <Tabs.Content value="files" className="h-full overflow-y-auto p-3">
          {files.length === 0 ? (
            <p className="py-10 text-center text-sm text-fg-subtle">
              {isTerminal
                ? "No files changed."
                : "Waiting for message processing to finish…"}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center justify-between gap-3 py-2 font-mono text-xs text-fg"
                >
                  <span className="min-w-0 truncate">{file.path}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-diff-add">+{file.additions}</span>{" "}
                    <span className="text-diff-remove">-{file.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tabs.Content>

        <Tabs.Content value="diff" className="h-full overflow-y-auto">
          {resultError && (
            <div className="p-3">
              <Alert variant="error">{resultError}</Alert>
            </div>
          )}
          {result ? (
            <DiffTable diff={result.diff} />
          ) : (
            <p className="py-10 text-center text-sm text-fg-subtle">
              {isTerminal
                ? "Loading diff…"
                : "Diff available once message processing finishes."}
            </p>
          )}
        </Tabs.Content>

        <Tabs.Content value="pr" className="h-full overflow-y-auto p-3">
          <PullRequestCard
            pullRequest={pullRequest}
            baseBranch={baseBranch}
            filesChanged={files.length}
            additions={totals.additions}
            deletions={totals.deletions}
          />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
};

const ResizeHandle = ({ onResize }: { onResize: (deltaX: number) => void }) => {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onResize(lastX.current - event.clientX);
    lastX.current = event.clientX;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") onResize(24);
    else if (event.key === "ArrowRight") onResize(-24);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center focus-visible:outline-none"
    >
      <div className="flex h-8 w-1 items-center justify-center rounded-full bg-border-default group-hover:bg-border-strong group-focus-visible:bg-brand">
        <GripVertical className="size-3 text-fg-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>
    </div>
  );
};

export const ChatWorkspacePage = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(
    null,
  );
  const [latestPullRequest, setLatestPullRequest] =
    useState<PullRequestMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);

  const { events: sessionEvents, connectionError: sessionConnectionError } =
    useEventStream(session?.eventsUrl ?? null);
  const lastHandledSequence = useRef(0);
  const { setActiveSession } = useActiveSession();

  const processingMessage =
    messages
      .filter(
        (message) =>
          message.role === "user" && message.processingStatus !== null,
      )
      .at(-1) ?? null;
  const eventPullRequest = useMemo(
    () => pullRequestFromEvents(sessionEvents),
    [sessionEvents],
  );
  const pullRequest =
    latestPullRequest ?? sessionResult?.pullRequest ?? eventPullRequest;

  const handlePullRequest = useCallback(
    (next: PullRequestMetadata | null) => setLatestPullRequest(next),
    [],
  );

  useEffect(() => {
    if (eventPullRequest) setLatestPullRequest(eventPullRequest);
  }, [eventPullRequest]);

  useEffect(() => {
    if (session) {
      setActiveSession({ repo: session.repo, message: processingMessage });
    }
  }, [processingMessage, session, setActiveSession]);

  useEffect(() => () => setActiveSession(null), [setActiveSession]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const [nextSession, page] = await Promise.all([
      getChatSession(sessionId),
      listMessages(sessionId, { limit: 100 }),
    ]);
    setSession(nextSession);
    setMessages(page.items);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setSession(null);
    setMessages([]);
    setSessionResult(null);
    setLatestPullRequest(null);
    setLoadError(null);
    lastHandledSequence.current = 0;

    refresh().catch((caught) => {
      if (cancelled) return;
      setLoadError(
        caught instanceof ApiError ? caught.message : "Failed to load session",
      );
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId, refresh]);

  useEffect(() => {
    const relevant = sessionEvents.filter(
      (event) =>
        event.sequence > lastHandledSequence.current &&
        SESSION_REFRESH_EVENT_TYPES.has(event.type),
    );
    if (relevant.length === 0) return;
    lastHandledSequence.current = sessionEvents.at(-1)?.sequence ?? 0;
    refresh().catch(() => undefined);
  }, [sessionEvents, refresh]);

  const processingStatus = processingMessage?.processingStatus ?? null;
  const processingIsTerminal =
    processingStatus !== null && TERMINAL_STATUSES.has(processingStatus);

  useEffect(() => {
    setSessionResult(null);
    setResultError(null);
    if (!sessionId || !processingMessage?.messageId || !processingIsTerminal)
      return;
    let cancelled = false;
    getSessionResult(sessionId)
      .then((result) => {
        if (!cancelled) setSessionResult(result);
        if (!cancelled) setLatestPullRequest(result.pullRequest);
      })
      .catch((caught) => {
        if (!cancelled)
          setResultError(
            caught instanceof ApiError
              ? caught.message
              : "Failed to load session result",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, processingIsTerminal, processingMessage?.messageId]);

  if (!sessionId)
    return (
      <main className="flex h-full items-center justify-center text-sm text-fg-subtle">
        Missing session id.
      </main>
    );

  const onSend = async (content: string) => {
    setSending(true);
    setSendError(null);
    const optimistic: ChatMessage = {
      messageId: `pending-${Date.now()}`,
      chatSessionId: sessionId,
      role: "user",
      content,
      processingStatus: "queued",
      processingStartedAt: null,
      processingCompletedAt: null,
      failure: null,
      agentSummary: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((previous) => [...previous, optimistic]);
    try {
      const response = await sendMessage(sessionId, { content });
      setMessages((previous) =>
        previous.map((message) =>
          message.messageId === optimistic.messageId
            ? response.message
            : message,
        ),
      );
      setSession((previous) =>
        previous
          ? {
              ...previous,
              status: "working",
              activeMessageId: response.message.messageId,
            }
          : previous,
      );
    } catch (caught) {
      setMessages((previous) =>
        previous.filter(
          (message) => message.messageId !== optimistic.messageId,
        ),
      );
      setSendError(
        caught instanceof ApiError ? caught.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  };

  const onCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelCurrentMessage(sessionId);
      await refresh();
    } catch (caught) {
      setCancelError(
        caught instanceof ApiError
          ? caught.message
          : "Failed to cancel message processing",
      );
    } finally {
      setCancelling(false);
    }
  };

  const processingActive = processingMessage !== null && !processingIsTerminal;
  const composerDisabled = sending || processingActive;
  const composerHint = processingActive
    ? "The agent is processing the previous message. Wait for it to finish or cancel it."
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">
            {session?.title ?? session?.repo.ref ?? "Chat"}
          </h1>
          {session && (
            <p className="truncate font-mono text-2xs text-fg-subtle">
              {session.repo.source}:{session.repo.ref}
            </p>
          )}
        </div>
      </div>

      {loadError && (
        <div className="px-4 pt-3">
          <Alert variant="error">{loadError}</Alert>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {session === null && !loadError ? (
            <p className="flex-1 py-10 text-center text-sm text-fg-subtle">
              Loading chat…
            </p>
          ) : (
            <ThreadPane
              messages={messages}
              pending={processingActive}
              pendingEvents={sessionEvents}
            />
          )}
          {sendError && <Alert variant="error">{sendError}</Alert>}
          {cancelError && <Alert variant="error">{cancelError}</Alert>}
          <PromptBar
            disabled={composerDisabled}
            disabledReason={composerHint}
            contextLabel={
              session ? `${session.repo.source}:${session.repo.ref}` : null
            }
            onSend={(content) => void onSend(content)}
          />
        </div>

        {processingMessage && (
          <>
            <ResizeHandle
              onResize={(deltaX) =>
                setInspectorWidth((width) =>
                  Math.min(
                    INSPECTOR_MAX_WIDTH,
                    Math.max(INSPECTOR_MIN_WIDTH, width + deltaX),
                  ),
                )
              }
            />
            <div
              style={{ width: inspectorWidth }}
              className="max-w-[70vw] shrink-0 border-l border-border-subtle bg-panel"
            >
              <ProcessingPanel
                message={processingMessage}
                sessionId={sessionId}
                baseBranch={
                  session?.repo.baseBranch ??
                  session?.repo.defaultBranch ??
                  "main"
                }
                events={sessionEvents}
                connectionError={sessionConnectionError}
                result={sessionResult}
                pullRequest={pullRequest}
                resultError={resultError}
                cancelling={cancelling}
                onCancel={() => void onCancel()}
                onPullRequest={handlePullRequest}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
