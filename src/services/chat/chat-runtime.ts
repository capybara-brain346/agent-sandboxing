import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { sandboxService } from "../sandbox/sandbox";
import type { PublicEvent } from "../../types/event.types";
import { AgentRunner } from "../agent/agent-runner";
import type { SessionAgent } from "../agent/session-agent";
import { resolveAgentModel } from "../agent/model";
import { ArtifactStore } from "../artifacts/artifact-store";
import { CompositeTraceSink } from "../tracing/composite-trace-sink";
import { TraceRecorder } from "../tracing/trace-recorder";
import { LangfuseTraceSink } from "../tracing/langfuse-trace-sink";
import { LocalTraceSink } from "../tracing/local-trace-sink";
import type { TraceSink } from "../../types/trace.types";
import { GitHubService } from "../github/github";

const config = loadConfig();
const events = new EventStore(prisma);
const publish = (event: PublicEvent): void => sseHub.publish(event);

export const chatArtifacts = new ArtifactStore(prisma);
const langfuse = new LangfuseTraceSink(config);
const traceSinks: TraceSink[] = [
  langfuse,
  ...(config.LOCAL_TRACE_EXPORT_ENABLED
    ? [new LocalTraceSink(config.LOCAL_TRACE_EXPORT_PATH)]
    : []),
];
export const chatTraceRecorder = new TraceRecorder(
  new CompositeTraceSink(traceSinks),
  {
    includeContextSnapshot: config.TRACE_CONTEXT_SNAPSHOT_ENABLED,
    tags: [`environment:${config.NODE_ENV}`, "source:chat-session"],
  },
);
export const chatGithub = new GitHubService(
  prisma,
  config,
  undefined,
  events,
  publish,
);
export const shutdownChatTracing = (): Promise<void> => langfuse.shutdown();

const placeholderProcessor: SessionAgent = {
  process: async () => ({
    finalText: "",
    usage: {},
    toolCalls: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  }),
};

export const chatAgentRunner: SessionAgent =
  config.NODE_ENV === "test"
    ? placeholderProcessor
    : new AgentRunner({
        config,
        sandbox: sandboxService,
        events,
        model: resolveAgentModel(config),
        publish,
        profile: "main",
        artifacts: chatArtifacts,
        traceRecorder: chatTraceRecorder,
        github: chatGithub,
      });
