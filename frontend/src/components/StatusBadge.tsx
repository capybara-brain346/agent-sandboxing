import type { TaskStatus } from "../api/types";

const TONE_BY_STATUS: Record<
  TaskStatus,
  "neutral" | "info" | "success" | "error"
> = {
  created: "neutral",
  provisioning: "info",
  running: "info",
  completed: "success",
  failed: "error",
  cancelled: "neutral",
};

const LABEL_BY_STATUS: Record<TaskStatus, string> = {
  created: "Queued",
  provisioning: "Provisioning",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const StatusBadge = ({ status }: { status: TaskStatus }) => (
  <span className={`badge badge--${TONE_BY_STATUS[status]}`}>
    {LABEL_BY_STATUS[status]}
  </span>
);
