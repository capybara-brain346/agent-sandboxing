import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, cancelTask, getTask, getTaskResult } from "../api/client";
import { useTaskEvents } from "../api/useTaskEvents";
import type { TaskResult, TaskSnapshot } from "../api/types";
import { DiffView } from "../components/DiffView";
import { EventTimeline } from "../components/EventTimeline";
import { StatusBadge } from "../components/StatusBadge";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const POLL_INTERVAL_MS = 2000;

const formatTimestamp = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "—";

const latestTimestamp = (snapshot: TaskSnapshot): string | null =>
  snapshot.completedAt ??
  snapshot.runningAt ??
  snapshot.provisioningAt ??
  snapshot.createdAt;

export const TaskDetailPage = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
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
        setPollError(null);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (cancelled) return;
        setPollError(
          caught instanceof ApiError ? caught.message : "Failed to load run",
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
          setResultError(
            caught instanceof ApiError
              ? caught.message
              : "Failed to load result",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, snapshot]);

  if (!taskId) return <main className="page">Missing run id.</main>;

  const onCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelTask(taskId);
    } catch (caught) {
      setCancelError(
        caught instanceof ApiError ? caught.message : "Failed to cancel run",
      );
    } finally {
      setCancelling(false);
    }
  };

  const canCancel =
    snapshot !== null && !TERMINAL_STATUSES.has(snapshot.status) && !cancelling;

  return (
    <main className="page page--wide">
      <div className="page-header">
        <div className="run-header">
          <span className="run-header__id">{taskId}</span>
          {snapshot && <StatusBadge status={snapshot.status} />}
          {canCancel && (
            <span className="run-header__actions">
              <button
                type="button"
                className="button button--danger"
                onClick={onCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel run"}
              </button>
            </span>
          )}
        </div>
        {cancelError && <p className="alert alert--error">{cancelError}</p>}
      </div>

      {pollError && <p className="alert alert--error">{pollError}</p>}

      {snapshot && (
        <section>
          <div className="panel">
            <div className="overview">
              <div className="overview__row">
                <span className="overview__label">Repo ref</span>
                <span className="overview__value overview__value--mono">
                  {snapshot.repoRef}
                </span>
              </div>
              <div className="overview__row">
                <span className="overview__label">Instructions</span>
                <span className="overview__value">{snapshot.instructions}</span>
              </div>
              <div className="overview__row">
                <span className="overview__label">Created</span>
                <span className="overview__value">
                  {formatTimestamp(snapshot.createdAt)}
                </span>
              </div>
              <div className="overview__row">
                <span className="overview__label">Updated</span>
                <span className="overview__value">
                  {formatTimestamp(latestTimestamp(snapshot))}
                </span>
              </div>
              {snapshot.failure && (
                <div className="overview__row">
                  <span className="overview__label">Failure</span>
                  <span className="overview__value">
                    <span className="alert alert--error">
                      {snapshot.failure.code}: {snapshot.failure.message}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Activity</span>
          </div>
          <div className="panel__body">
            {connectionError && (
              <p className="alert alert--warning">
                Event stream disconnected, retrying…
              </p>
            )}
            <EventTimeline events={events} />
          </div>
        </div>
      </section>

      {snapshot && TERMINAL_STATUSES.has(snapshot.status) && (
        <section>
          <div className="panel">
            <div className="panel__header">
              <span className="panel__title">Result</span>
            </div>
            <div className="panel__body">
              {resultError && (
                <p className="alert alert--error">{resultError}</p>
              )}
              {result && (
                <>
                  <div className="result-summary">
                    <p className="result-summary__row">
                      Exit reason: <strong>{result.exitReason}</strong>
                    </p>
                    {result.agentSummary && (
                      <p className="result-summary__row">
                        {result.agentSummary}
                      </p>
                    )}
                    {result.failure && (
                      <p className="alert alert--error">
                        {result.failure.code}: {result.failure.message}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
            {result && <DiffView diff={result.diff} />}
          </div>
        </section>
      )}
    </main>
  );
};
