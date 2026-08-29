import { loadConfig } from "../../config";
import { prisma } from "../../db/prisma";
import { EventStore } from "../events/event-store";
import { sseHub } from "../events/sse-hub";
import { sandboxService } from "../sandbox/sandbox";
import type { PublicEvent } from "../../types/event.types";
import { AgentRunner } from "../agent/agent-runner";
import type { CodeWorker } from "../agent/code-worker";
import { resolveAgentModel } from "../agent/model";
import { ArtifactStore } from "../artifacts/artifact-store";
import { CompositeTraceSink } from "../eval/composite-trace-sink";
import { EvalTraceRecorder } from "../eval/eval-trace-recorder";
import { LangfuseTraceSink } from "../eval/langfuse-trace-sink";
import { LocalTraceSink } from "../eval/local-trace-sink";
import type { EvalTraceSink } from "../../types/eval-trace.types";
import { GitHubService } from "../github/github";

const config = loadConfig();
const events = new EventStore(prisma);
const publish = (event: PublicEvent): void => sseHub.publish(event);

export const chatArtifacts = new ArtifactStore(prisma);
const langfuse = new LangfuseTraceSink(config);
const traceSinks: EvalTraceSink[] = [
  langfuse,
  ...(config.LOCAL_TRACE_EXPORT_ENABLED
    ? [new LocalTraceSink(config.LOCAL_TRACE_EXPORT_PATH)]
    : []),
];
export const chatTraceRecorder = new EvalTraceRecorder(
  new CompositeTraceSink(traceSinks),
  {
    includeContextSnapshot: config.EVAL_TRACE_CONTEXT_SNAPSHOT_ENABLED,
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

const placeholderProcessor: CodeWorker = {
  process: async () => ({
    status: "completed",
    summary: "",
  }),
};

export const chatWorker: CodeWorker =
  config.NODE_ENV === "test"
    ? placeholderProcessor
    : new AgentRunner({
        config,
        sandbox: sandboxService,
        events,
        model: resolveAgentModel(config),
        publish,
        artifacts: chatArtifacts,
        traceRecorder: chatTraceRecorder,
        github: chatGithub,
      });
