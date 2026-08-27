import { useState } from "react";
import { Collapsible } from "radix-ui";
import { ChevronRight } from "lucide-react";
import type { PublicChatEvent } from "@/api/types";
import { cn } from "@/lib/utils";

const describeEvent = (event: PublicChatEvent): string => {
  if (event.type === "agent_tool_call") {
    const toolName = event.payload.tool_name;
    return typeof toolName === "string" ? `Calling ${toolName}` : event.type;
  }
  if (event.type === "agent_tool_result") {
    const toolName = event.payload.tool_name;
    return typeof toolName === "string" ? `${toolName} finished` : event.type;
  }
  return event.type.replace(/_/g, " ");
};

/** Collapsible trace of the live event tail, shown while a run is non-terminal. */
export const ThinkingBlock = ({
  events,
  active,
  tailLength = 3,
}: {
  events: PublicChatEvent[];
  active: boolean;
  tailLength?: number;
}) => {
  const [open, setOpen] = useState(false);
  if (!active && events.length === 0) return null;

  const tail = events.slice(-tailLength);
  const latest = tail.at(-1);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="w-fit max-w-full rounded-lg border border-border-subtle bg-panel"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="relative flex size-2 shrink-0">
          {active && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
          )}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              active ? "bg-brand" : "bg-fg-subtle",
            )}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted italic">
          {active ? (latest ? describeEvent(latest) : "Thinking…") : "Trace"}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-border-subtle px-3 py-2">
        <ol className="flex flex-col gap-1">
          {tail.map((event) => (
            <li
              key={event.sequence}
              className="font-mono text-2xs text-fg-subtle"
            >
              {describeEvent(event)}
            </li>
          ))}
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};
