import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_PREVIEW_MAX_BYTES,
  ArtifactStore,
} from "../src/services/artifacts/artifact-store";

const makePrisma = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const artifact = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      rows.set(data.id as string, {
        ...data,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      return data;
    }),
    findFirst: vi.fn(
      async ({ where }: { where: { id: string; sessionId: string } }) => {
        const row = rows.get(where.id);
        if (!row || row.sessionId !== where.sessionId) return null;
        return row;
      },
    ),
  };
  const prisma = { artifact } as unknown as Pick<PrismaClient, "artifact">;
  return { prisma, artifact };
};

describe("ArtifactStore", () => {
  it("creates an artifact and returns a bounded pointer with a preview", async () => {
    const { prisma, artifact } = makePrisma();
    const store = new ArtifactStore(prisma);

    const pointer = await store.create({
      sessionId: "chat_1",
      messageId: "msg_1",
      kind: "diff",
      contentType: "text/x-diff",
      content: "diff --git a/x b/x\n+hello",
    });

    expect(pointer.artifactId).toMatch(/^art_/);
    expect(pointer.kind).toBe("diff");
    expect(pointer.truncated).toBe(false);
    expect(pointer.redacted).toBe(false);
    expect(pointer.preview).toBe("diff --git a/x b/x\n+hello");
    expect(pointer.byteSize).toBeGreaterThan(0);
    expect(artifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: "chat_1",
          messageId: "msg_1",
        }),
      }),
    );
  });

  it("truncates content over the byte cap and marks it truncated", async () => {
    const { prisma } = makePrisma();
    const store = new ArtifactStore(prisma);
    const huge = "a".repeat(ARTIFACT_MAX_BYTES + 1024);

    const pointer = await store.create({
      sessionId: "chat_1",
      kind: "command_output",
      contentType: "text/plain",
      content: huge,
    });

    expect(pointer.truncated).toBe(true);
    expect(pointer.byteSize).toBe(ARTIFACT_MAX_BYTES);
  });

  it("bounds the preview independently of the stored content size", async () => {
    const { prisma } = makePrisma();
    const store = new ArtifactStore(prisma);
    const content = "b".repeat(ARTIFACT_PREVIEW_MAX_BYTES + 1000);

    const pointer = await store.create({
      sessionId: "chat_1",
      kind: "tool_output",
      contentType: "text/plain",
      content,
    });

    expect(Buffer.byteLength(pointer.preview, "utf8")).toBeLessThanOrEqual(
      ARTIFACT_PREVIEW_MAX_BYTES,
    );
    expect(pointer.truncated).toBe(false);
  });

  it("redacts secret-shaped content and reports redacted=true", async () => {
    const { prisma } = makePrisma();
    const store = new ArtifactStore(prisma);

    const pointer = await store.create({
      sessionId: "chat_1",
      kind: "command_output",
      contentType: "text/plain",
      content: 'export API_KEY="sk-abcdefghijklmnopqrstuvwx"',
    });

    expect(pointer.redacted).toBe(true);
    const stored = await store.get("chat_1", pointer.artifactId);
    expect(stored.content).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(stored.content).toContain("[REDACTED]");
  });

  it("fetches full content scoped to the owning session", async () => {
    const { prisma } = makePrisma();
    const store = new ArtifactStore(prisma);
    const pointer = await store.create({
      sessionId: "chat_1",
      messageId: "msg_1",
      kind: "tool_output",
      contentType: "application/json",
      content: '{"status":"completed"}',
    });

    const full = await store.get("chat_1", pointer.artifactId);
    expect(full).toMatchObject({
      artifactId: pointer.artifactId,
      sessionId: "chat_1",
      messageId: "msg_1",
      kind: "tool_output",
      content: '{"status":"completed"}',
    });
  });

  it("throws not_found when the artifact belongs to a different session", async () => {
    const { prisma } = makePrisma();
    const store = new ArtifactStore(prisma);
    const pointer = await store.create({
      sessionId: "chat_1",
      kind: "diff",
      contentType: "text/x-diff",
      content: "diff",
    });

    await expect(store.get("chat_2", pointer.artifactId)).rejects.toMatchObject(
      {
        code: "artifact_not_found",
      },
    );
  });
});
