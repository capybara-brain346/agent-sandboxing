import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, cancelTask, getTask, getTaskResult } from "../api/client";
import { useTaskEvents } from "../api/useTaskEvents";
import type { TaskResult, TaskSnapshot } from "../api/types";
import { EventTimeline } from "../components/EventTimeline";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 2000;

export const TaskDetailPage = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const { events, connectionError } = useTaskEvents(
    snapshot?.eventsUrl ?? null,
  );

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await getTask(taskId);
        if (cancelled) return;
        setSnapshot(next);
        setLoadError(null);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        setLoadError(
          caught instanceof ApiError ? caught.message : "Failed to load task",
        );
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !snapshot || !TERMINAL_STATUSES.has(snapshot.status)) return;
    let cancelled = false;
    getTaskResult(taskId)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((caught) => {
        if (!cancelled)
          setLoadError(
            caught instanceof ApiError
              ? caught.message
              : "Failed to load result",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, snapshot]);

  if (!taskId) return <main className="page">Missing task id.</main>;

  const onCancel = async () => {
    setCancelling(true);
    try {
      await cancelTask(taskId);
    } catch (caught) {
      setLoadError(
        caught instanceof ApiError ? caught.message : "Failed to cancel task",
      );
    } finally {
      setCancelling(false);
    }
  };

  const canCancel =
    snapshot !== null && !TERMINAL_STATUSES.has(snapshot.status) && !cancelling;

  return (
    <main className="page">
      <h1>Task {taskId}</h1>
      {loadError && <p className="form-error">{loadError}</p>}
      {snapshot && (
        <section className="task-status">
          <p>
            Status: <strong>{snapshot.status}</strong>
          </p>
          <p>Repo: {snapshot.repoRef}</p>
          <p>Instructions: {snapshot.instructions}</p>
          {snapshot.failure && (
            <p className="form-error">
              {snapshot.failure.code}: {snapshot.failure.message}
            </p>
          )}
          {canCancel && (
            <button type="button" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel task"}
            </button>
          )}
        </section>
      )}

      <section>
        <h2>Event timeline</h2>
        {connectionError && (
          <p className="form-error">Event stream disconnected, retrying…</p>
        )}
        <EventTimeline events={events} />
      </section>

      {result && (
        <section>
          <h2>Result</h2>
          <p>Exit reason: {result.exitReason}</p>
          {result.agentSummary && <p>{result.agentSummary}</p>}
          {result.failure && (
            <p className="form-error">
              {result.failure.code}: {result.failure.message}
            </p>
          )}
        </section>
      )}
    </main>
  );
};
