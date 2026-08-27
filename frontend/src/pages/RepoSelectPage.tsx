import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  createChatSession,
  getAuthMe,
  getGitHubBranches,
  getGitHubRepositories,
  listChatSessions,
  logout,
} from "../api/client";
import type {
  AuthMe,
  ChatSessionListItem,
  GitHubRepository,
  GitHubRepositoriesResponse,
} from "../api/types";
import { StatusBadge } from "../components/StatusBadge";

const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleString();

export const RepoSelectPage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthMe | null>(null);
  const [connection, setConnection] =
    useState<GitHubRepositoriesResponse | null>(null);
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState<GitHubRepository["branches"]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAuthMe(),
      getGitHubRepositories(),
      listChatSessions({ limit: 25 }),
    ])
      .then(([nextUser, nextConnection, recent]) => {
        if (cancelled) return;
        setUser(nextUser);
        setConnection(nextConnection);
        setSessions(recent.items);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(
          caught instanceof ApiError
            ? caught.message
            : "Failed to load GitHub repositories",
        );
        setReconnectRequired(
          caught instanceof ApiError &&
            caught.code === "github_reconnect_required",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const selectedRepo: GitHubRepository | undefined =
    connection?.repositories.find(
      (repository) => repository.repoId === selectedRepoId,
    );
  const selectedDefaultBranch = selectedRepo?.defaultBranch;
  const hasInstallations = (connection?.installations.length ?? 0) > 0;
  const hasRepositories = (connection?.repositories.length ?? 0) > 0;

  const refreshAccess = async () => {
    setLoadingAccess(true);
    setLoadError(null);
    setReconnectRequired(false);
    setSelectedRepoId("");
    setSelectedBranch("");
    setBranches([]);
    try {
      setConnection(await getGitHubRepositories());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setLoadError(
        caught instanceof ApiError
          ? caught.message
          : "Failed to load GitHub repositories",
      );
      setReconnectRequired(
        caught instanceof ApiError &&
          caught.code === "github_reconnect_required",
      );
    } finally {
      setLoadingAccess(false);
    }
  };

  const selectRepository = async (repoId: string) => {
    setSelectedRepoId(repoId);
    setSelectedBranch("");
    setBranches([]);
    if (!repoId) return;
    setLoadingBranches(true);
    setLoadError(null);
    setReconnectRequired(false);
    try {
      setBranches(await getGitHubBranches(repoId));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setLoadError(
        caught instanceof ApiError ? caught.message : "Failed to load branches",
      );
      setReconnectRequired(
        caught instanceof ApiError &&
          caught.code === "github_reconnect_required",
      );
    } finally {
      setLoadingBranches(false);
    }
  };

  const selectBranch = async (branchName: string) => {
    setSelectedBranch(branchName);
    if (!selectedRepo || !branchName) return;
    const branch = branches.find((candidate) => candidate.name === branchName);
    if (!branch) return;
    setCreating(true);
    setLoadError(null);
    setReconnectRequired(false);
    try {
      const session = await createChatSession({
        repo: {
          source: "github",
          ref: `github:${selectedRepo.fullName}`,
          provider: "github",
          owner: selectedRepo.owner,
          name: selectedRepo.name,
          repoId: selectedRepo.repoId,
          defaultBranch: selectedRepo.defaultBranch,
          installationId: selectedRepo.installationId,
          baseBranch: branch.name,
          baseSha: branch.sha,
        },
      });
      navigate(`/sessions/${session.chatSessionId}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setLoadError(
        caught instanceof ApiError ? caught.message : "Failed to create chat",
      );
      setReconnectRequired(
        caught instanceof ApiError &&
          caught.code === "github_reconnect_required",
      );
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  return (
    <main className="page page--wide repos-page">
      <div className="page-header repos-page__header">
        <div>
          <div className="login-page__eyebrow">REPOSITORY ACCESS</div>
          <h1>Choose where to work</h1>
          <p className="page-subtitle">
            Select a personal repository and hand the agent an exact branch
            point.
          </p>
        </div>
        {user && (
          <div className="user-menu">
            <img className="user-menu__avatar" src={user.avatarUrl} alt="" />
            <span>{user.login}</span>
            <button
              className="button button--secondary"
              type="button"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {loadError && (
        <div className="alert alert--error">
          <span>{loadError}</span>
          {reconnectRequired && (
            <a href="/auth/github/start">Reconnect GitHub</a>
          )}
        </div>
      )}

      <section className="repo-picker">
        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">GitHub repositories</span>
            {hasRepositories && (
              <a className="button button--secondary" href="/github/install">
                Manage access
              </a>
            )}
          </div>
          <div className="panel__body">
            {loadingAccess && !connection && !loadError && (
              <p className="run-inspector__empty">Checking GitHub access...</p>
            )}
            {!loadingAccess && connection && !hasInstallations && (
              <div className="empty-state">
                <h2>Set up repository access</h2>
                <p>
                  Choose your personal GitHub account and select which
                  repositories Agent Sandboxing can use.
                </p>
                <a className="button" href="/github/install">
                  Set up repository access
                </a>
              </div>
            )}
            {!loadingAccess &&
              connection &&
              hasInstallations &&
              !hasRepositories && (
                <div className="empty-state">
                  <h2>No shared repositories</h2>
                  <p>
                    The GitHub App is installed for your account, but no
                    repositories are available to both your GitHub login and the
                    App installation. Manage access in GitHub, then refresh.
                  </p>
                  <div className="empty-state__actions">
                    <a className="button" href="/github/install">
                      Manage repository access
                    </a>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => void refreshAccess()}
                    >
                      Refresh access
                    </button>
                  </div>
                </div>
              )}
            {connection && hasRepositories && (
              <div className="repo-picker__controls">
                <p className="field__hint repo-picker__hint">
                  Select a repository, then choose a branch.
                </p>
                <label className="field">
                  <span className="field__label">Repository</span>
                  <select
                    value={selectedRepoId}
                    onChange={(event) =>
                      void selectRepository(event.target.value)
                    }
                    disabled={creating}
                  >
                    <option value="">Choose a repository</option>
                    {connection.repositories.map((repository) => (
                      <option key={repository.repoId} value={repository.repoId}>
                        {repository.fullName}
                        {repository.private ? "  [private]" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Branch</span>
                  <select
                    value={selectedBranch}
                    onChange={(event) => void selectBranch(event.target.value)}
                    disabled={!selectedRepo || loadingBranches || creating}
                  >
                    <option value="">
                      {loadingBranches
                        ? "Loading branches..."
                        : "Choose a branch"}
                    </option>
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                        {branch.name === selectedDefaultBranch
                          ? "  [default]"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {creating && (
                  <p className="field__hint">Opening workspace...</p>
                )}
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => void refreshAccess()}
                  disabled={loadingAccess || creating}
                >
                  {loadingAccess ? "Refreshing access..." : "Refresh access"}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="panel">
          <div className="panel__header">
            <span className="panel__title">Recent chats</span>
          </div>
          <div className="panel__body">
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
