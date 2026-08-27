import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ApiError,
  cancelRun,
  getChatSession,
  getRunResult,
  listMessages,
  sendMessage,
} from "../api/client";
import { useEventStream } from "../api/useEventStream";
import type { ChatMessage, ChatSession, RunResult } from "../api/types";
import { TERMINAL_STATUSES } from "../api/types";
import { Composer } from "../components/Composer";
import { MessageThread } from "../components/MessageThread";
import { RunInspector } from "../components/RunInspector";
import { useActiveSession } from "../context/ActiveSessionContext";

const SESSION_REFRESH_EVENT_TYPES = new Set([
  "message_created",
  "run_requested",
  "run_created",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_result_ready",
]);

export const ChatWorkspacePage = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { events } = useEventStream(session?.eventsUrl ?? null);
  const lastHandledSequence = useRef(0);
  const { setActiveSession } = useActiveSession();

  useEffect(() => {
    if (session) {
      setActiveSession({ repo: session.repo, run: session.latestRun });
    }
  }, [session, setActiveSession]);

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
    setRunResult(null);
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
    const relevant = events.filter(
      (event) =>
        event.sequence > lastHandledSequence.current &&
        SESSION_REFRESH_EVENT_TYPES.has(event.type),
    );
    if (relevant.length === 0) return;
    lastHandledSequence.current = events.at(-1)?.sequence ?? 0;
    refresh().catch(() => undefined);
  }, [events, refresh]);

  const run = session?.latestRun ?? null;
  const runId = run?.taskRunId ?? null;
  const runStatus = run?.status ?? null;
  const runIsTerminal = runStatus !== null && TERMINAL_STATUSES.has(runStatus);

  useEffect(() => {
    setRunResult(null);
    setResultError(null);
    if (!sessionId || !runId || !runIsTerminal) return;
    let cancelled = false;
    getRunResult(sessionId, runId)
      .then((result) => {
        if (!cancelled) setRunResult(result);
      })
      .catch((caught) => {
        if (!cancelled)
          setResultError(
            caught instanceof ApiError
              ? caught.message
              : "Failed to load run result",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, runId, runIsTerminal]);

  if (!sessionId) return <main className="page">Missing session id.</main>;

  const onSend = async (content: string) => {
    setSending(true);
    setSendError(null);
    const optimistic: ChatMessage = {
      messageId: `pending-${Date.now()}`,
      chatSessionId: sessionId,
      role: "user",
      content,
      taskRunId: null,
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
      if (response.run) {
        setSession((previous) =>
          previous ? { ...previous, latestRun: response.run } : previous,
        );
      }
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
    if (!runId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelRun(sessionId, runId);
      await refresh();
    } catch (caught) {
      setCancelError(
        caught instanceof ApiError ? caught.message : "Failed to cancel run",
      );
    } finally {
      setCancelling(false);
    }
  };

  const runActive = run !== null && !runIsTerminal;
  const composerDisabled = sending || runActive;
  const composerHint = runActive
    ? "The agent is working on the previous message. Wait for it to finish or cancel it."
    : null;

  return (
    <main className="page page--wide chat-workspace">
      <div className="page-header">
        <h1>{session?.title ?? session?.repo.ref ?? "Chat"}</h1>
        {session && (
          <p className="page-subtitle page-subtitle--mono">
            {session.repo.source}:{session.repo.ref}
          </p>
        )}
      </div>

      {loadError && <p className="alert alert--error">{loadError}</p>}

      <div className="chat-workspace__layout">
        <div className="chat-workspace__thread">
          <div className="panel">
            <div className="panel__body">
              {session === null && !loadError ? (
                <p className="message-thread--empty">Loading chat…</p>
              ) : (
                <MessageThread messages={messages} pending={runActive} />
              )}
            </div>
          </div>
          {sendError && <p className="alert alert--error">{sendError}</p>}
          {cancelError && <p className="alert alert--error">{cancelError}</p>}
          <Composer
            disabled={composerDisabled}
            disabledReason={composerHint}
            onSend={onSend}
          />
        </div>

        <div className="chat-workspace__inspector">
          {run ? (
            <RunInspector
              run={run}
              result={runResult}
              resultError={resultError}
              cancelling={cancelling}
              onCancel={onCancel}
            />
          ) : (
            <div className="panel">
              <div className="panel__header">
                <span className="panel__title">Run</span>
              </div>
              <div className="panel__body">
                <p className="run-inspector__empty">
                  No run yet. Send a message to start one.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
