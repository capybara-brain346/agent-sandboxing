CREATE TYPE "ChatMessageProcessingStatus" AS ENUM ('queued', 'working', 'completed', 'failed', 'cancelled');

ALTER TABLE "chat_messages"
ADD COLUMN "processing_status" "ChatMessageProcessingStatus",
ADD COLUMN "processing_started_at" TIMESTAMP(3),
ADD COLUMN "processing_completed_at" TIMESTAMP(3),
ADD COLUMN "failure_code" TEXT,
ADD COLUMN "failure_message" TEXT,
ADD COLUMN "agent_summary" TEXT,
ADD COLUMN "diff" TEXT,
ADD COLUMN "exit_reason" TEXT;

ALTER TABLE "chat_sessions" ADD COLUMN "active_message_id" TEXT;
ALTER TABLE "artifacts" ADD COLUMN "message_id" TEXT;
ALTER TABLE "pull_requests" ADD COLUMN "message_id" TEXT;

WITH user_messages AS (
    SELECT DISTINCT ON (run_id) id, run_id
    FROM "chat_messages"
    WHERE run_id IS NOT NULL AND role = 'user'
    ORDER BY run_id, created_at, id
)
UPDATE "chat_messages" AS message
SET
    processing_status = CASE task.status::text
        WHEN 'created' THEN 'queued'::"ChatMessageProcessingStatus"
        WHEN 'provisioning' THEN 'working'::"ChatMessageProcessingStatus"
        WHEN 'running' THEN 'working'::"ChatMessageProcessingStatus"
        WHEN 'completed' THEN 'completed'::"ChatMessageProcessingStatus"
        WHEN 'failed' THEN 'failed'::"ChatMessageProcessingStatus"
        WHEN 'cancelled' THEN 'cancelled'::"ChatMessageProcessingStatus"
    END,
    processing_started_at = COALESCE(task.provisioning_at, task.running_at),
    processing_completed_at = COALESCE(task.completed_at, task.failed_at, task.cancelled_at),
    failure_code = task.failure_code,
    failure_message = task.failure_message,
    agent_summary = task.agent_summary,
    diff = task.diff,
    exit_reason = task.exit_reason
FROM "tasks" AS task
JOIN user_messages AS user_message ON user_message.run_id = task.id
WHERE message.id = user_message.id;

WITH user_messages AS (
    SELECT DISTINCT ON (run_id) id, run_id
    FROM "chat_messages"
    WHERE run_id IS NOT NULL AND role = 'user'
    ORDER BY run_id, created_at, id
)
UPDATE "artifacts" AS artifact
SET message_id = message.id
FROM user_messages AS message
WHERE artifact.run_id = message.run_id;

WITH user_messages AS (
    SELECT DISTINCT ON (run_id) id, run_id
    FROM "chat_messages"
    WHERE run_id IS NOT NULL AND role = 'user'
    ORDER BY run_id, created_at, id
)
UPDATE "pull_requests" AS pull_request
SET message_id = message.id
FROM user_messages AS message
WHERE pull_request.run_id = message.run_id;

WITH user_messages AS (
    SELECT DISTINCT ON (run_id) id, run_id
    FROM "chat_messages"
    WHERE run_id IS NOT NULL AND role = 'user'
    ORDER BY run_id, created_at, id
)
UPDATE "events" AS event
SET message_id = message.id
FROM user_messages AS message
WHERE event.message_id IS NULL
  AND (event.run_id = message.run_id OR event.task_id = message.run_id);

WITH user_messages AS (
    SELECT DISTINCT ON (run_id) id, run_id
    FROM "chat_messages"
    WHERE run_id IS NOT NULL AND role = 'user'
    ORDER BY run_id, created_at, id
)
UPDATE "chat_sessions" AS session
SET active_message_id = message.id
FROM user_messages AS message
WHERE session.active_run_id = message.run_id;

DROP INDEX "chat_sessions_active_run_id_key";
DROP INDEX "chat_messages_run_id_created_at_idx";
DROP INDEX "artifacts_run_id_created_at_idx";
DROP INDEX "pull_requests_run_id_idx";
DROP INDEX "events_run_id_sequence_idx";
DROP INDEX "events_task_id_sequence_idx";
DROP INDEX "tasks_sandbox_id_key";
DROP INDEX "tasks_status_created_at_idx";
DROP INDEX "tasks_created_at_idx";
DROP INDEX "tasks_session_id_created_at_idx";
DROP INDEX "sandboxes_task_id_key";

ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_run_id_fkey";
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_run_id_fkey";
ALTER TABLE "pull_requests" DROP CONSTRAINT "pull_requests_run_id_fkey";
ALTER TABLE "events" DROP CONSTRAINT "events_run_id_fkey";
ALTER TABLE "events" DROP CONSTRAINT "events_task_id_fkey";
ALTER TABLE "sandboxes" DROP CONSTRAINT "sandboxes_task_id_fkey";
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_sandbox_id_fkey";
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_session_id_fkey";

ALTER TABLE "chat_sessions" DROP COLUMN "active_run_id";
ALTER TABLE "chat_messages" DROP COLUMN "run_id";
ALTER TABLE "artifacts" DROP COLUMN "run_id";
ALTER TABLE "pull_requests" DROP COLUMN "run_id";
ALTER TABLE "events" DROP COLUMN "run_id", DROP COLUMN "task_id";
ALTER TABLE "sandboxes" DROP COLUMN "task_id";
DROP TABLE "tasks";
DROP TYPE "TaskStatus";

ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "chat_sessions_active_message_id_key" ON "chat_sessions"("active_message_id");
CREATE INDEX "artifacts_message_id_created_at_idx" ON "artifacts"("message_id", "created_at");
CREATE INDEX "pull_requests_message_id_idx" ON "pull_requests"("message_id");
