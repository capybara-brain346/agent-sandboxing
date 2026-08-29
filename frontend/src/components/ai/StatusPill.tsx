import type { MessageProcessingStatus } from "@/api/types";
import { TERMINAL_STATUSES } from "@/api/types";
import { cn } from "@/lib/utils";

const LABEL_BY_STATUS: Record<MessageProcessingStatus, string> = {
  queued: "Queued",
  working: "Working",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const DOT_CLASS_BY_STATUS: Record<MessageProcessingStatus, string> = {
  queued: "bg-fg-subtle",
  working: "bg-status-running",
  completed: "bg-status-completed",
  failed: "bg-status-failed",
  cancelled: "bg-status-cancelled",
};

const TEXT_CLASS_BY_STATUS: Record<MessageProcessingStatus, string> = {
  queued: "text-fg-muted",
  working: "text-status-running",
  completed: "text-status-completed",
  failed: "text-status-failed",
  cancelled: "text-fg-muted",
};

export const StatusPill = ({
  status,
  size = "md",
}: {
  status: MessageProcessingStatus;
  size?: "sm" | "md";
}) => {
  const nonTerminal = !TERMINAL_STATUSES.has(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-raised font-medium",
        TEXT_CLASS_BY_STATUS[status],
        size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
      )}
    >
      <span className="relative flex size-1.5 shrink-0">
        {nonTerminal && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              DOT_CLASS_BY_STATUS[status],
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex size-1.5 rounded-full",
            DOT_CLASS_BY_STATUS[status],
          )}
        />
      </span>
      {LABEL_BY_STATUS[status]}
    </span>
  );
};
