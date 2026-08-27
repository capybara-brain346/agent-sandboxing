import { Check, Loader2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolChipState = "pending" | "done" | "error";

const ICON_BY_STATE: Record<ToolChipState, typeof Wrench> = {
  pending: Loader2,
  done: Check,
  error: X,
};

const CLASS_BY_STATE: Record<ToolChipState, string> = {
  pending: "border-border-default text-fg-muted",
  done: "border-status-completed/30 text-status-completed",
  error: "border-status-failed/30 text-status-failed",
};

export const ToolChip = ({
  name,
  state = "done",
  detail,
}: {
  name: string;
  state?: ToolChipState;
  detail?: string | null;
}) => {
  const Icon = ICON_BY_STATE[state];

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-inset px-2 py-1 font-mono text-2xs",
        CLASS_BY_STATE[state],
      )}
      title={detail ?? undefined}
    >
      <Icon
        className={cn("size-3 shrink-0", state === "pending" && "animate-spin")}
      />
      <span className="truncate">{name}</span>
      {detail && <span className="truncate text-fg-subtle">{detail}</span>}
    </span>
  );
};
