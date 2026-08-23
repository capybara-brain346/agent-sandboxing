import { useEffect, useRef, useState } from "react";
import type { RunResult, RunSnapshot } from "../api/types";
import { TERMINAL_STATUSES } from "../api/types";
import { useEventStream } from "../api/useEventStream";
import { DiffView } from "./DiffView";
import { EventTimeline } from "./EventTimeline";
import { StatusBadge } from "./StatusBadge";

type Tab = "timeline" | "files" | "diff" | "pr";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "files", label: "Changed files" },
  { id: "diff", label: "Diff" },
  { id: "pr", label: "Pull request" },
];

const changedFiles = (diff: string): string[] => {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = /^diff --git a\/(.+) b\/.+$/.exec(line);
    if (match) files.push(match[1]);
  }
  return files;
};

export const RunInspector = ({
  run,
  result,
  resultError,
  cancelling,
  onCancel,
}: {
  run: RunSnapshot;
  result: RunResult | null;
  resultError: string | null;
  cancelling: boolean;
  onCancel: () => void;
}) => {
  const [tab, setTab] = useState<Tab>("timeline");
  const { events, connectionError } = useEventStream(run.eventsUrl);
  const isTerminal = TERMINAL_STATUSES.has(run.status);
  const files = result ? changedFiles(result.diff) : [];

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

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="panel__title">Run</span>
        <div className="run-inspector__header-actions">
          <StatusBadge status={run.status} />
          {!isTerminal && (
            <button
              type="button"
              className="button button--danger"
              onClick={onCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel run"}
            </button>
          )}
        </div>
      </div>
      <div className="run-inspector__tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`run-inspector__tab ${
              tab === item.id ? "run-inspector__tab--active" : ""
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="panel__body run-inspector__body"
        role="tabpanel"
        ref={bodyRef}
        onScroll={handleBodyScroll}
      >
        {connectionError && (
          <p className="alert alert--warning">
            Event stream disconnected, retrying…
          </p>
        )}
        {run.failure && (
          <p className="alert alert--error">
            {run.failure.code}: {run.failure.message}
          </p>
        )}
        {tab === "timeline" && <EventTimeline events={events} />}
        {tab === "files" &&
          (files.length === 0 ? (
            <p className="run-inspector__empty">
              {isTerminal ? "No files changed." : "Waiting for run to finish…"}
            </p>
          ) : (
            <ul className="changed-files">
              {files.map((file) => (
                <li key={file} className="changed-files__item">
                  {file}
                </li>
              ))}
            </ul>
          ))}
        {tab === "diff" && (
          <>
            {resultError && <p className="alert alert--error">{resultError}</p>}
            {result ? (
              <DiffView diff={result.diff} />
            ) : (
              <p className="run-inspector__empty">
                {isTerminal
                  ? "Loading diff…"
                  : "Diff available once the run finishes."}
              </p>
            )}
          </>
        )}
        {tab === "pr" && (
          <p className="run-inspector__empty">
            Pull request creation isn't wired up yet — changes stay in this
            session's sandbox until the GitHub integration ships.
          </p>
        )}
      </div>
    </div>
  );
};
