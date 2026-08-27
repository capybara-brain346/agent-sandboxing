import type { ReactNode } from "react";
import { AlertTriangle, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_BY_VARIANT = {
  error: CircleX,
  warning: AlertTriangle,
} as const;

const CLASS_BY_VARIANT = {
  error: "border-status-failed/30 bg-status-failed/10 text-status-failed",
  warning: "border-status-running/30 bg-status-running/10 text-status-running",
} as const;

export const Alert = ({
  variant = "error",
  children,
  action,
}: {
  variant?: "error" | "warning";
  children: ReactNode;
  action?: ReactNode;
}) => {
  const Icon = ICON_BY_VARIANT[variant];

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        CLASS_BY_VARIANT[variant],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span>{children}</span>
        {action}
      </div>
    </div>
  );
};
