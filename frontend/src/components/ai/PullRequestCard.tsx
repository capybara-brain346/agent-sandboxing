import { ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import type { PullRequestMetadata } from "@/api/types";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<PullRequestMetadata["status"], string> = {
  creating: "Creating",
  open: "Open",
  closed: "Closed",
  merged: "Merged",
  failed: "Failed",
};

const STATUS_CLASSES: Record<PullRequestMetadata["status"], string> = {
  creating: "border-status-running/30 bg-status-running/10 text-status-running",
  open: "border-status-completed/30 bg-status-completed/10 text-status-completed",
  closed: "border-border-default bg-raised text-fg-muted",
  merged: "border-brand/30 bg-brand/10 text-brand",
  failed: "border-status-failed/30 bg-status-failed/10 text-status-failed",
};

export const PullRequestCard = ({
  pullRequest,
  baseBranch,
  filesChanged,
  additions,
  deletions,
}: {
  pullRequest: PullRequestMetadata | null;
  baseBranch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}) => (
  <div className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-panel p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitPullRequest className="size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-fg">
            {pullRequest?.title ?? "Pull request"}
          </p>
          <p className="m-0 text-2xs text-fg-subtle">
            {pullRequest ? `#${pullRequest.number ?? "new"}` : "No PR yet"}
          </p>
        </div>
      </div>
      {pullRequest && (
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-2xs font-medium",
            STATUS_CLASSES[pullRequest.status],
          )}
        >
          {STATUS_LABELS[pullRequest.status]}
        </span>
      )}
    </div>

    {pullRequest ? (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1 font-mono">
            <GitBranch className="size-3 text-fg-subtle" />
            {pullRequest.branch}
          </span>
          <span className="font-mono">into {pullRequest.baseBranch}</span>
          {pullRequest.draft && (
            <span className="rounded border border-border-default px-1.5 py-0.5 text-2xs text-fg-muted">
              Draft
            </span>
          )}
        </div>
        {pullRequest.failure && (
          <p className="m-0 text-xs text-status-failed text-pretty">
            {pullRequest.failure.message}
          </p>
        )}
        {pullRequest.url && (
          <a
            href={pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Open on GitHub
            <ExternalLink className="size-3" />
          </a>
        )}
      </>
    ) : (
      <p className="m-0 text-xs text-fg-muted text-pretty">
        No pull request yet. Ask the agent to open one after the changes are
        committed.
      </p>
    )}

    <div className="flex items-center gap-3 border-t border-border-subtle pt-3 text-xs text-fg-muted">
      <span className="font-mono">
        {filesChanged} file{filesChanged === 1 ? "" : "s"} changed
      </span>
      <span className="font-mono tabular-nums">
        <span className="text-diff-add">+{additions}</span>{" "}
        <span className="text-diff-remove">-{deletions}</span>
      </span>
      {!pullRequest && (
        <span className="font-mono text-fg-subtle">into {baseBranch}</span>
      )}
    </div>
  </div>
);
