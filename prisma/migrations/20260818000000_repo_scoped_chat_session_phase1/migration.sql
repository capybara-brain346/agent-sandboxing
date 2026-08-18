-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant', 'system');

-- AlterTable
ALTER TABLE "sandboxes" ADD COLUMN     "session_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "verification_metadata" JSONB;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "artifact_id" TEXT,
ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'task',
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "run_id" TEXT,
ADD COLUMN     "session_id" TEXT,
ADD COLUMN     "stream_scope" TEXT NOT NULL DEFAULT 'task';

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "repo_ref" TEXT NOT NULL,
    "repo_source" TEXT NOT NULL DEFAULT 'local',
    "repo_provider" TEXT,
    "repo_owner" TEXT,
    "repo_name" TEXT,
    "repo_id" TEXT,
    "repo_default_branch" TEXT,
    "repo_installation_id" TEXT,
    "summary" TEXT,
    "next_event_sequence" INTEGER NOT NULL DEFAULT 1,
    "active_run_id" TEXT,
    "locked_at" TIMESTAMP(3),
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "run_id" TEXT,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "run_id" TEXT,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_active_run_id_key" ON "chat_sessions"("active_run_id");

-- CreateIndex
CREATE INDEX "chat_sessions_created_at_idx" ON "chat_sessions"("created_at");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_run_id_created_at_idx" ON "chat_messages"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_session_id_created_at_idx" ON "artifacts"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_run_id_created_at_idx" ON "artifacts"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sandboxes_session_id_key" ON "sandboxes"("session_id");

-- CreateIndex
CREATE INDEX "tasks_session_id_created_at_idx" ON "tasks"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "events_session_id_sequence_idx" ON "events"("session_id", "sequence");

-- CreateIndex
CREATE INDEX "events_run_id_sequence_idx" ON "events"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "events_message_id_idx" ON "events"("message_id");

-- CreateIndex
CREATE INDEX "events_artifact_id_idx" ON "events"("artifact_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
