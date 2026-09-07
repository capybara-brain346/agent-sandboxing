import type { ChatMessage } from "@/api/types";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "./MarkdownMessage";
import { StreamingText } from "./StreamingText";

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "You",
  assistant: "Agent",
  system: "System",
};

export const MessageBubble = ({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) => {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex max-w-[90%] flex-col gap-0.5 rounded-lg px-3 py-2.5",
        isUser ? "self-end bg-inset" : "self-start bg-panel",
      )}
    >
      <span className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
        {ROLE_LABEL[message.role]}
      </span>
      {isAssistant ? (
        <MarkdownMessage text={message.content} streaming={streaming} />
      ) : (
        <StreamingText text={message.content} streaming={streaming} />
      )}
    </div>
  );
};
