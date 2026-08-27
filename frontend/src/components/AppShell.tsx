import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Popover } from "radix-ui";
import {
  ChevronDown,
  GitBranch,
  Loader2,
  LogOut,
  Moon,
  Plus,
  Sparkles,
  Sun,
} from "lucide-react";
import {
  ApiError,
  createChatSession,
  getAuthMe,
  getGitHubBranches,
  getGitHubRepositories,
  listChatSessions,
  logout,
} from "@/api/client";
import type {
  AuthMe,
  ChatSessionListItem,
  GitHubBranch,
  GitHubRepository,
  GitHubRepositoriesResponse,
  TaskStatus,
} from "@/api/types";
import {
  ActiveSessionProvider,
  useActiveSession,
} from "@/context/ActiveSessionContext";
import {
  applyTheme,
  getInitialTheme,
  persistTheme,
  type ThemeMode,
} from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<TaskStatus, string> = {
  created: "Queued",
  provisioning: "Provisioning",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  created: "bg-fg-subtle",
  provisioning: "bg-status-running",
  running: "bg-status-running",
  completed: "bg-status-completed",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
};

const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleString();

const RepoBranchSwitcher = () => {
  const navigate = useNavigate();
  const { activeSession } = useActiveSession();
  const [open, setOpen] = useState(false);
  const [connection, setConnection] =
    useState<GitHubRepositoriesResponse | null>(null);
  const [expandedRepoId, setExpandedRepoId] = useState<string | null>(null);
  const [branchesByRepo, setBranchesByRepo] = useState<
    Record<string, GitHubBranch[]>
  >({});
  const [loadingBranchesFor, setLoadingBranchesFor] = useState<string | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getGitHubRepositories()
      .then(setConnection)
      .catch(() => setConnection(null));
  }, []);

  const toggleRepo = async (repository: GitHubRepository) => {
    if (expandedRepoId === repository.repoId) {
      setExpandedRepoId(null);
      return;
    }
    setExpandedRepoId(repository.repoId);
    if (branchesByRepo[repository.repoId]) return;
    setLoadingBranchesFor(repository.repoId);
    try {
      const branches = await getGitHubBranches(repository.repoId);
      setBranchesByRepo((previous) => ({
        ...previous,
        [repository.repoId]: branches,
      }));
    } catch {
      // Leave the branch list empty; the full picker at /repos surfaces errors.
    } finally {
      setLoadingBranchesFor(null);
    }
  };

  const selectBranch = async (
    repository: GitHubRepository,
    branch: GitHubBranch,
  ) => {
    setCreating(true);
    try {
      const session = await createChatSession({
        repo: {
          source: "github",
          ref: `github:${repository.fullName}`,
          provider: "github",
          owner: repository.owner,
          name: repository.name,
          repoId: repository.repoId,
          defaultBranch: repository.defaultBranch,
          installationId: repository.installationId,
          baseBranch: branch.name,
          baseSha: branch.sha,
        },
      });
      setOpen(false);
      navigate(`/sessions/${session.chatSessionId}`);
    } catch {
      // The full picker at /repos surfaces creation errors in detail.
    } finally {
      setCreating(false);
    }
  };

  const triggerLabel = activeSession
    ? activeSession.repo.ref.replace(/^github:/, "")
    : "Switch repository";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-raised px-2.5 py-1 text-xs font-mono text-fg hover:border-border-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <GitBranch className="size-3.5 text-fg-subtle" />
          <span className="max-w-48 truncate">{triggerLabel}</span>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-30 w-80 overflow-hidden rounded-lg border border-border-default bg-overlay shadow-lg"
        >
          <div className="border-b border-border-subtle px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
            Repositories
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {connection === null && (
              <p className="px-2 py-3 text-xs text-fg-subtle">
                Connect GitHub from the repos page to switch context here.
              </p>
            )}
            {connection?.repositories.length === 0 && (
              <p className="px-2 py-3 text-xs text-fg-subtle">
                No repositories available yet.
              </p>
            )}
            {connection?.repositories.map((repository) => (
              <div key={repository.repoId}>
                <button
                  type="button"
                  onClick={() => void toggleRepo(repository)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="truncate">{repository.fullName}</span>
                  {loadingBranchesFor === repository.repoId ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-subtle" />
                  ) : (
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 text-fg-subtle transition-transform",
                        expandedRepoId === repository.repoId && "rotate-180",
                      )}
                    />
                  )}
                </button>
                {expandedRepoId === repository.repoId && (
                  <div className="ml-2 border-l border-border-subtle pl-2">
                    {(branchesByRepo[repository.repoId] ?? []).map((branch) => (
                      <button
                        key={branch.name}
                        type="button"
                        disabled={creating}
                        onClick={() => void selectBranch(repository, branch)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-xs text-fg-muted hover:bg-panel disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {branch.name}
                        {branch.name === repository.defaultBranch && (
                          <span className="text-fg-subtle">default</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-border-subtle px-3 py-2">
            <Link
              to="/repos"
              onClick={() => setOpen(false)}
              className="text-xs text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Open full repository picker
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

const RunStatusPill = () => {
  const { activeSession } = useActiveSession();
  const status = activeSession?.run?.status;
  if (!status) return null;

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-raised px-2.5 py-1 text-xs text-fg-muted">
      <span
        className={cn(
          "size-1.5 rounded-full",
          STATUS_DOT_CLASS[status],
          status === "running" && "animate-pulse",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
};

const ThemeToggle = () => {
  const [mode, setMode] = useState<ThemeMode>(getInitialTheme);

  const toggle = () => {
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    setMode(next);
    applyTheme(next);
    persistTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-panel hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {mode === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
};

const UserMenu = ({ user }: { user: AuthMe }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <img src={user.avatarUrl} alt="" className="size-6 rounded-full" />
          <span className="text-xs text-fg-muted">{user.login}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-30 w-44 overflow-hidden rounded-lg border border-border-default bg-overlay shadow-lg"
        >
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

const Sidebar = ({ sessions }: { sessions: ChatSessionListItem[] }) => {
  const { sessionId: activeSessionId } = useParams<{ sessionId?: string }>();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border-subtle bg-panel">
      <div className="px-3 pt-4 pb-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
        Sessions
      </div>
      <nav className="flex-1 overflow-y-auto px-1.5">
        {sessions.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-fg-subtle">No chats yet.</p>
        )}
        {sessions.map((session) => {
          const isActive = session.chatSessionId === activeSessionId;
          return (
            <Link
              key={session.chatSessionId}
              to={`/sessions/${session.chatSessionId}`}
              className={cn(
                "mb-0.5 flex flex-col gap-0.5 rounded-md px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                isActive ? "bg-raised" : "hover:bg-raised/60",
              )}
            >
              <span className="flex items-center gap-1.5 truncate text-xs font-medium text-fg">
                {session.latestRunStatus && (
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      STATUS_DOT_CLASS[session.latestRunStatus],
                    )}
                  />
                )}
                <span className="truncate">
                  {session.title ?? session.repo.ref}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2 text-2xs text-fg-subtle">
                <span className="truncate">
                  {session.lastMessagePreview ?? "No messages yet"}
                </span>
                <span className="shrink-0">
                  {formatTimestamp(session.updatedAt)}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border-subtle p-2">
        <Link
          to="/repos"
          className="flex items-center justify-center gap-1.5 rounded-md border border-border-subtle py-1.5 text-xs font-medium text-fg-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Plus className="size-3.5" />
          New
        </Link>
      </div>
    </aside>
  );
};

const ShellChrome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AuthMe | null>(null);
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    getAuthMe()
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          navigate("/login", { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    listChatSessions({ limit: 25 })
      .then((page) => {
        if (!cancelled) setSessions(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Refetch whenever the route changes so a newly created session appears.
  }, [location.pathname]);

  return (
    <div className="flex h-screen flex-col bg-canvas text-fg">
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border-subtle bg-panel px-4">
        <Link
          to="/"
          className="flex items-center gap-1.5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Sparkles className="size-4 text-brand" />
          <span className="text-sm">sandbox</span>
        </Link>
        <span className="text-border-strong">/</span>
        <RepoBranchSwitcher />
        <RunStatusPill />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user && <UserMenu user={user} />}
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar sessions={sessions} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export const AppShell = () => (
  <ActiveSessionProvider>
    <ShellChrome />
  </ActiveSessionProvider>
);
