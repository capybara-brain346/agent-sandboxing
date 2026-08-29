import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../shared/errors";
import { runQuery } from "../../shared/query-logging";
import { boundUtf8 } from "../../shared/utf8";
import type {
  ArtifactContent,
  ArtifactPreview,
} from "../../types/artifact.types";

export const ARTIFACT_MAX_BYTES = 64 * 1024;
export const ARTIFACT_PREVIEW_MAX_BYTES = 500;

const SECRET_PATTERNS = [
  /(?:api|access|secret)[_-]?key\s*[:=]\s*['"]?[\w-]{16,}/gi,
  /bearer\s+[\w.-]{16,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
];

export const redact = (
  content: string,
): { content: string; redacted: boolean } => {
  let next = content;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const replaced = next.replace(pattern, "[REDACTED]");
    if (replaced !== next) redacted = true;
    next = replaced;
  }
  return { content: next, redacted };
};

export type CreateArtifactInput = {
  sessionId: string;
  messageId?: string | null;
  kind: string;
  contentType: string;
  content: string;
};

export type ArtifactRecorder = {
  create(input: CreateArtifactInput): Promise<ArtifactPreview>;
};

const artifactId = (): string =>
  `art_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

/**
 * Stores operational output (command/tool output, diffs, worker reports)
 * outside the chat/prompt path. Content is capped and secret-scrubbed on
 * write; callers get back a bounded pointer+preview, never the full body,
 * so large output cannot leak into event payloads or model context by
 * accident. Full content is only readable via `get`, scoped to its session.
 */
export class ArtifactStore implements ArtifactRecorder {
  constructor(private readonly prisma: Pick<PrismaClient, "artifact">) {}

  async create(input: CreateArtifactInput): Promise<ArtifactPreview> {
    const { content: scrubbed, redacted } = redact(input.content);
    const bounded = boundUtf8(scrubbed, ARTIFACT_MAX_BYTES);
    const byteSize = Buffer.byteLength(bounded.value, "utf8");
    const id = artifactId();

    await runQuery(
      "create_artifact",
      {
        sessionId: input.sessionId,
        messageId: input.messageId,
        kind: input.kind,
      },
      () =>
        this.prisma.artifact.create({
          data: {
            id,
            sessionId: input.sessionId,
            messageId: input.messageId ?? null,
            kind: input.kind,
            contentType: input.contentType,
            content: bounded.value,
            byteSize,
            truncated: bounded.truncated,
            redacted,
          },
        }),
    );

    return {
      artifactId: id,
      kind: input.kind,
      contentType: input.contentType,
      byteSize,
      truncated: bounded.truncated,
      redacted,
      preview: boundUtf8(bounded.value, ARTIFACT_PREVIEW_MAX_BYTES).value,
    };
  }

  async get(sessionId: string, artifactId: string): Promise<ArtifactContent> {
    const row = await runQuery("get_artifact", { sessionId, artifactId }, () =>
      this.prisma.artifact.findFirst({
        where: { id: artifactId, sessionId },
      }),
    );
    if (!row) throw notFound("artifact_not_found", "Artifact was not found");
    return {
      artifactId: row.id,
      sessionId: row.sessionId,
      messageId: row.messageId,
      kind: row.kind,
      contentType: row.contentType,
      content: row.content,
      byteSize: row.byteSize,
      truncated: row.truncated,
      redacted: row.redacted,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const noopArtifactRecorder: ArtifactRecorder = {
  create: async (input) => ({
    artifactId: "",
    kind: input.kind,
    contentType: input.contentType,
    byteSize: 0,
    truncated: false,
    redacted: false,
    preview: "",
  }),
};
