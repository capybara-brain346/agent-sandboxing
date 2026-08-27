import { GitPullRequest } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Designed now, wired once the pull-request endpoint lands. Until then every
 * caller renders it with `disabled` and a reason explaining the gap.
 */
export const ApprovalCard = ({
  baseBranch,
  filesChanged,
  additions,
  deletions,
  disabled = true,
  reason,
  onApprove,
}: {
  baseBranch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  disabled?: boolean;
  reason?: string | null;
  onApprove?: () => void;
}) => (
  <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4">
    <div className="flex items-center gap-2">
      <GitPullRequest className="size-4 shrink-0 text-fg-subtle" />
      <span className="text-sm font-semibold text-fg">Open a pull request</span>
    </div>
    <div className="flex items-center gap-3 text-xs text-fg-muted">
      <span className="font-mono">
        {filesChanged} file{filesChanged === 1 ? "" : "s"} changed
      </span>
      <span className="font-mono tabular-nums">
        <span className="text-diff-add">+{additions}</span>{" "}
        <span className="text-diff-remove">-{deletions}</span>
      </span>
      <span className="font-mono text-fg-subtle">into {baseBranch}</span>
    </div>
    <button
      type="button"
      disabled={disabled || !onApprove}
      onClick={onApprove}
      className={cn(
        "w-fit rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-fg-on-brand transition-opacity",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      Create pull request
    </button>
    {disabled && reason && (
      <p className="m-0 text-2xs text-fg-subtle">{reason}</p>
    )}
  </div>
);
