import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  GitBranch,
  Loader2,
  PlugZap,
  RefreshCw,
  Search,
  SearchX,
} from "lucide-react";
import {
  ApiError,
  createChatSession,
  getGitHubBranches,
  getGitHubRepositories,
  isSessionAuthFailure,
} from "@/api/client";
import type { GitHubRepository, GitHubRepositoriesResponse } from "@/api/types";
import { ContextCard, Skeleton } from "@/components/ai";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EmptyState = ({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: typeof PlugZap;
  title: string;
  description: string;
  actions: ReactNode;
}) => (
  <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-default p-8">
    <span className="flex size-9 items-center justify-center rounded-full bg-inset text-fg-subtle">
      <Icon className="size-4" />
    </span>
    <h2 className="text-sm font-semibold text-fg">{title}</h2>
    <p className="max-w-md text-sm text-fg-muted">{description}</p>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
);

const BranchPicker = ({
  repository,
  branches,
  loading,
  selectedBranch,
  creating,
  onSelect,
}: {
  repository: GitHubRepository;
  branches: GitHubRepository["branches"];
  loading: boolean;
  selectedBranch: string;
  creating: boolean;
  onSelect: (branchName: string) => void;
}) => (
  <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3">
    <p className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">
      Branch in {repository.fullName}
    </p>
    {loading ? (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-7 w-24" />
      </div>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {branches.map((branch) => (
          <button
            key={branch.name}
            type="button"
            disabled={creating}
            onClick={() => onSelect(branch.name)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors disabled:opacity-50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              selectedBranch === branch.name
                ? "border-brand bg-brand/10 text-brand"
                : "border-border-subtle bg-raised text-fg-muted hover:border-border-default hover:text-fg",
            )}
          >
            <GitBranch className="size-3" />
            {branch.name}
            {branch.name === repository.defaultBranch && (
              <span className="text-fg-subtle">default</span>
            )}
            {creating && selectedBranch === branch.name && (
              <Loader2 className="size-3 animate-spin" />
            )}
          </button>
        ))}
      </div>
    )}
  </div>
);

export const RepoSelectPage = () => {
  const navigate = useNavigate();
  const [connection, setConnection] =
    useState<GitHubRepositoriesResponse | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState<GitHubRepository["branches"]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGitHubRepositories()
      .then((nextConnection) => {
        if (cancelled) return;
        setConnection(nextConnection);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (isSessionAuthFailure(caught)) {
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
  const hasInstallations = (connection?.installations.length ?? 0) > 0;
  const hasRepositories = (connection?.repositories.length ?? 0) > 0;

  const filteredRepositories = useMemo(() => {
    const repositories = connection?.repositories ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return repositories;
    return repositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(normalized),
    );
  }, [connection, query]);

  const refreshAccess = async () => {
    setLoadingAccess(true);
    setLoadError(null);
    setReconnectRequired(false);
    setSelectedRepoId("");
    setSelectedBranch("");
    setBranches([]);
    try {
      setConnection(await getGitHubRepositories({ forceRefresh: true }));
    } catch (caught) {
      if (isSessionAuthFailure(caught)) {
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

  const selectRepository = async (repository: GitHubRepository) => {
    setSelectedRepoId(repository.repoId);
    setSelectedBranch("");
    setBranches([]);
    setLoadingBranches(true);
    setLoadError(null);
    setReconnectRequired(false);
    try {
      setBranches(await getGitHubBranches(repository.repoId));
    } catch (caught) {
      if (isSessionAuthFailure(caught)) {
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
    if (!selectedRepo) return;
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

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-2xs font-semibold tracking-widest text-fg-subtle uppercase">
            Repository access
          </p>
          <h1 className="mt-1 text-xl font-semibold text-fg">
            Choose where to work
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Select a personal repository and hand the agent an exact branch
            point.
          </p>
        </div>
        {hasRepositories && (
          <Button asChild variant="outline" size="sm">
            <a href="/github/install">Manage access</a>
          </Button>
        )}
      </div>

      {loadError && !reconnectRequired && (
        <Alert variant="error">{loadError}</Alert>
      )}

      {loadingAccess && !connection && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!loadingAccess && reconnectRequired && (
        <EmptyState
          icon={RefreshCw}
          title="GitHub connection needs a refresh"
          description="Your GitHub authorization expired or was revoked. Reconnect to keep browsing repositories."
          actions={
            <Button asChild size="sm">
              <a href="/auth/github/start">Reconnect GitHub</a>
            </Button>
          }
        />
      )}

      {!loadingAccess &&
        !reconnectRequired &&
        connection &&
        !hasInstallations && (
          <EmptyState
            icon={PlugZap}
            title="Set up repository access"
            description="Choose your personal GitHub account and select which repositories Agent Sandboxing can use."
            actions={
              <Button asChild size="sm">
                <a href="/github/install">Set up repository access</a>
              </Button>
            }
          />
        )}

      {!loadingAccess &&
        !reconnectRequired &&
        connection &&
        hasInstallations &&
        !hasRepositories && (
          <EmptyState
            icon={SearchX}
            title="No shared repositories"
            description="The GitHub App is installed for your account, but no repositories are available to both your GitHub login and the App installation. Manage access in GitHub, then refresh."
            actions={
              <>
                <Button asChild size="sm">
                  <a href="/github/install">Manage repository access</a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshAccess()}
                >
                  Refresh access
                </Button>
              </>
            }
          />
        )}

      {!reconnectRequired && connection && hasRepositories && (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search repositories…"
              disabled={creating}
              className="w-full rounded-md border border-border-subtle bg-panel py-2 pr-3 pl-8 text-sm text-fg outline-none placeholder:text-fg-subtle focus-visible:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredRepositories.map((repository) => (
              <ContextCard
                key={repository.repoId}
                repository={repository}
                disabled={creating}
                onSelect={(picked) => void selectRepository(picked)}
              />
            ))}
            {filteredRepositories.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-fg-subtle">
                No repositories match “{query}”.
              </p>
            )}
          </div>

          {selectedRepo && (
            <BranchPicker
              repository={selectedRepo}
              branches={branches}
              loading={loadingBranches}
              selectedBranch={selectedBranch}
              creating={creating}
              onSelect={(branchName) => void selectBranch(branchName)}
            />
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void refreshAccess()}
            disabled={loadingAccess || creating}
          >
            {loadingAccess ? "Refreshing access…" : "Refresh access"}
          </Button>
        </div>
      )}
    </main>
  );
};
