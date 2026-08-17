import type { PublicTaskEvent } from "../api/types";

const describePayload = (event: PublicTaskEvent): string | null => {
  const payload = event.payload;
  switch (event.type) {
    case "command_started":
      return typeof payload.command === "string"
        ? String(payload.command)
        : null;
    case "command_output":
      return typeof payload.chunk === "string" ? String(payload.chunk) : null;
    case "command_completed":
      return `exit_code=${String(payload.exit_code)}`;
    case "command_failed":
    case "command_timed_out":
    case "sandbox_failed":
    case "task_failed":
      return typeof payload.message === "string"
        ? String(payload.message)
        : null;
    case "agent_tool_call":
      return typeof payload.tool_name === "string"
        ? String(payload.tool_name)
        : null;
    case "agent_tool_result":
      return [payload.tool_name, payload.result_snippet]
        .filter((value) => typeof value === "string")
        .join(": ");
    default:
      return null;
  }
};

export const EventTimeline = ({ events }: { events: PublicTaskEvent[] }) => (
  <ol className="event-timeline">
    {events.map((event) => {
      const detail = describePayload(event);
      return (
        <li
          key={event.sequence}
          className={`event event--${event.producerService}`}
        >
          <span className="event__sequence">#{event.sequence}</span>
          <span className="event__type">{event.type}</span>
          <span className="event__time">
            {new Date(event.createdAt).toLocaleTimeString()}
          </span>
          {detail && <pre className="event__detail">{detail}</pre>}
        </li>
      );
    })}
  </ol>
);
