import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, listChatSessions } from "../api/client";
import type { ChatSessionListItem } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";

const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleString();

export const RepoSelectPage = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listChatSessions({ limit: 25 })
      .then((page) => {
        if (!cancelled) setSessions(page.items);
      })
      .catch((caught) => {
        if (cancelled) return;
        setLoadError(
          caught instanceof ApiError
            ? caught.message
            : "Failed to load recent chats",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page page--wide">
      <div className="page-header">
        <h1>Select a repo</h1>
        <p className="page-subtitle">
          Start a chat-driven agent session against a repository.
        </p>
      </div>

      <section>
        <div className="repo-cards">
          <div className="repo-card repo-card--disabled">
            <div className="repo-card__body">
              <span className="repo-card__title">GitHub repository</span>
              <p className="repo-card__description">
                Log in with GitHub to select a repository and run an agent
                session against your own code.
              </p>
            </div>
            <button type="button" className="button button--secondary" disabled>
              Log in with GitHub (coming soon)
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Recent chats</span>
          </div>
          <div className="panel__body">
            {loadError && <p className="alert alert--error">{loadError}</p>}
            {sessions.length === 0 && !loadError && (
              <p className="run-inspector__empty">No chats yet.</p>
            )}
            {sessions.length > 0 && (
              <ul className="session-list">
                {sessions.map((session) => (
                  <li
                    key={session.chatSessionId}
                    className="session-list__item"
                  >
                    <button
                      type="button"
                      className="session-list__link"
                      onClick={() =>
                        navigate(`/sessions/${session.chatSessionId}`)
                      }
                    >
                      <span className="session-list__title">
                        {session.title ?? session.repo.ref}
                      </span>
                      <span className="session-list__preview">
                        {session.lastMessagePreview ?? "No messages yet"}
                      </span>
                    </button>
                    <div className="session-list__meta">
                      {session.latestRunStatus && (
                        <StatusBadge status={session.latestRunStatus} />
                      )}
                      <span className="session-list__time">
                        {formatTimestamp(session.updatedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
