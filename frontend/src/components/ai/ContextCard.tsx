import { GitBranch, Lock } from "lucide-react";
import type { GitHubRepository } from "@/api/types";
import { cn } from "@/lib/utils";

export const ContextCard = ({
  repository,
  disabled = false,
  disabledReason,
  onSelect,
}: {
  repository: GitHubRepository;
  disabled?: boolean;
  disabledReason?: string | null;
  onSelect?: (repository: GitHubRepository) => void;
}) => (
  <button
    type="button"
    disabled={disabled || !onSelect}
    onClick={() => onSelect?.(repository)}
    className={cn(
      "flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4 text-left transition-colors",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
      !disabled && onSelect && "hover:border-border-default hover:bg-raised",
      disabled && "opacity-60",
    )}
  >
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 truncate text-sm font-semibold text-fg">
        {repository.fullName}
      </span>
      {repository.private && (
        <Lock className="size-3.5 shrink-0 text-fg-subtle" />
      )}
    </div>
    <span className="flex items-center gap-1.5 font-mono text-xs text-fg-muted">
      <GitBranch className="size-3.5 shrink-0" />
      {repository.defaultBranch}
    </span>
    {disabled && disabledReason && (
      <span className="text-2xs text-fg-subtle">{disabledReason}</span>
    )}
  </button>
);
