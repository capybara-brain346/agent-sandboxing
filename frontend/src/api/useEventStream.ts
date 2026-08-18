import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "./client";
import { EVENT_TYPES, type PublicChatEvent } from "./types";

export const useEventStream = (
  eventsUrl: string | null,
): { events: PublicChatEvent[]; connectionError: boolean } => {
  const [events, setEvents] = useState<PublicChatEvent[]>([]);
  const [connectionError, setConnectionError] = useState(false);
  const seenSequences = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!eventsUrl) return;
    setEvents([]);
    seenSequences.current = new Set();
    setConnectionError(false);

    const source = new EventSource(`${API_BASE_URL}${eventsUrl}`);

    const onEvent = (message: MessageEvent<string>): void => {
      const parsed = JSON.parse(message.data) as PublicChatEvent;
      if (seenSequences.current.has(parsed.sequence)) return;
      seenSequences.current.add(parsed.sequence);
      setEvents((previous) =>
        [...previous, parsed].sort((a, b) => a.sequence - b.sequence),
      );
    };

    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onerror = () => setConnectionError(true);
    source.onopen = () => setConnectionError(false);

    return () => {
      for (const type of EVENT_TYPES) source.removeEventListener(type, onEvent);
      source.close();
    };
  }, [eventsUrl]);

  return { events, connectionError };
};
