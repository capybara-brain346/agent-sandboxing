import { useState } from "react";
import { Collapsible } from "radix-ui";
import {
  Bot,
  Box,
  ChevronRight,
  Cpu,
  Terminal,
  Trash2,
  type LucideIcon,
  ListChecks,
} from "lucide-react";
import type { PublicChatEvent } from "@/api/types";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { ToolChip } from "./ToolChip";

const ICON_BY_PRODUCER: Record<string, LucideIcon> = {
  task: ListChecks,
  sandbox: Box,
  command: Terminal,
  runtime: Cpu,
  cleanup: Trash2,
  agent: Bot,
};

const describeDetail = (event: PublicChatEvent): string | null => {
  const payload = event.payload;
  switch (event.type) {
    case "command_started":
      return typeof payload.command === "string" ? payload.command : null;
    case "command_output":
      return typeof payload.chunk === "string" ? payload.chunk : null;
    case "command_completed":
      return `exit_code=${String(payload.exit_code)}`;
    case "command_failed":
    case "command_timed_out":
    case "sandbox_failed":
    case "task_failed":
      return typeof payload.message === "string" ? payload.message : null;
    case "agent_tool_call":
      return typeof payload.tool_name === "string" ? payload.tool_name : null;
    case "agent_tool_result":
      return [payload.tool_name, payload.result_snippet]
        .filter((value) => typeof value === "string")
        .join(": ");
    default:
      return null;
  }
};

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};

export const TaskRow = ({
  event,
  previousEvent,
}: {
  event: PublicChatEvent;
  previousEvent?: PublicChatEvent;
}) => {
  const [open, setOpen] = useState(false);
  const Icon = ICON_BY_PRODUCER[event.producerService] ?? ListChecks;
  const detail = describeDetail(event);
  const elapsed = previousEvent
    ? Date.parse(event.createdAt) - Date.parse(previousEvent.createdAt)
    : null;

  if (event.type === "agent_tool_call" || event.type === "agent_tool_result") {
    const toolName =
      typeof event.payload.tool_name === "string"
        ? event.payload.tool_name
        : event.type;
    const resultSnippet =
      typeof event.payload.result_snippet === "string"
        ? event.payload.result_snippet
        : null;
    return (
      <li className="flex items-center gap-2 px-3 py-1.5">
        <span className="w-10 shrink-0 font-mono text-2xs text-fg-subtle tabular-nums">
          #{event.sequence}
        </span>
        <ToolChip
          name={toolName}
          state={event.type === "agent_tool_call" ? "pending" : "done"}
          detail={resultSnippet}
        />
      </li>
    );
  }

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="border-b border-border-subtle last:border-b-0"
    >
      <Collapsible.Trigger
        disabled={!detail}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left",
          detail && "hover:bg-panel",
        )}
      >
        <span className="w-10 shrink-0 font-mono text-2xs text-fg-subtle tabular-nums">
          #{event.sequence}
        </span>
        <Icon className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
          {event.type}
        </span>
        {elapsed !== null && elapsed >= 0 && (
          <span className="shrink-0 font-mono text-2xs text-fg-subtle tabular-nums">
            {formatElapsed(elapsed)}
          </span>
        )}
        <span className="w-14 shrink-0 text-right text-2xs text-fg-subtle tabular-nums">
          {new Date(event.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        {detail && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-fg-subtle transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </Collapsible.Trigger>
      {detail && (
        <Collapsible.Content className="px-3 pb-2">
          <CodeBlock code={detail} className="text-2xs" />
        </Collapsible.Content>
      )}
    </Collapsible.Root>
  );
};
