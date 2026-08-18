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
  if (messages.length === 0 && !pending) {
    return (
      <p className="message-thread--empty">
        Send a message to start working in this repo.
      </p>
    );
  }

  return (
    <ol className="message-thread">
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
