import { useEffect, useRef } from "react";
import type { ChatMessage } from "../api/types";

const roleLabel: Record<ChatMessage["role"], string> = {
  user: "You",
  assistant: "Agent",
  system: "System",
};

export const MessageThread = ({
  messages,
  pending,
}: {
  messages: ChatMessage[];
  pending: boolean;
}) => {
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 32;
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <p className="message-thread--empty">
        Send a message to start working in this repo.
      </p>
    );
  }

  return (
    <ol className="message-thread" ref={listRef} onScroll={handleScroll}>
      {messages.map((message) => (
        <li
          key={message.messageId}
          className={`message message--${message.role}`}
        >
          <span className="message__role">{roleLabel[message.role]}</span>
          <p className="message__content">{message.content}</p>
        </li>
      ))}
      {pending && (
        <li className="message message--assistant message--pending">
          <span className="message__role">{roleLabel.assistant}</span>
          <p className="message__content message__content--pending">Working…</p>
        </li>
      )}
    </ol>
  );
};
