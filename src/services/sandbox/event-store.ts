// Compatibility import for internal sandbox code and existing consumers.
// The Event Store now lives outside the sandbox service boundary.
export {
  EventStore,
  type AppendEventInput,
  type CommandEventInput,
  type SandboxEventInput,
  type TaskEventInput,
} from "../events/event-store";
