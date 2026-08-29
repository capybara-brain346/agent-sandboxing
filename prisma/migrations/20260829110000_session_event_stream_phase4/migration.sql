DELETE FROM "events"
WHERE "session_id" IS NULL;

DROP INDEX "events_stream_scope_stream_id_sequence_key";

UPDATE "events"
SET
    "type" = CASE "type"
        WHEN 'run_requested' THEN 'message_processing_requested'
        WHEN 'run_created' THEN 'message_processing_started'
        WHEN 'run_completed' THEN 'message_processing_completed'
        WHEN 'run_failed' THEN 'message_processing_failed'
        WHEN 'run_cancelled' THEN 'message_processing_cancelled'
        WHEN 'run_result_ready' THEN 'message_result_ready'
        WHEN 'task_created' THEN 'message_processing_requested'
        WHEN 'task_provisioning_started' THEN 'message_processing_started'
        WHEN 'task_running' THEN 'message_processing_started'
        WHEN 'task_completed' THEN 'message_processing_completed'
        WHEN 'task_failed' THEN 'message_processing_failed'
        WHEN 'task_cancelled' THEN 'message_processing_cancelled'
        WHEN 'task_result_ready' THEN 'message_result_ready'
        ELSE "type"
    END,
    "producer_service" = CASE
        WHEN "producer_service" = 'task' THEN 'chat'
        ELSE "producer_service"
    END,
    "domain" = CASE
        WHEN "domain" IN ('task', 'run') THEN 'message'
        ELSE "domain"
    END;

WITH ordered AS (
    SELECT
        "id",
        "session_id",
        ROW_NUMBER() OVER (
            PARTITION BY "session_id"
            ORDER BY "created_at", "id"
        )::INTEGER AS "sequence"
    FROM "events"
)
UPDATE "events" AS event
SET
    "stream_id" = ordered."session_id",
    "stream_scope" = 'session',
    "sequence" = ordered."sequence"
FROM ordered
WHERE event."id" = ordered."id";

UPDATE "chat_sessions" AS session
SET "next_event_sequence" = GREATEST(
    "next_event_sequence",
    COALESCE(
        (
            SELECT MAX("sequence") + 1
            FROM "events" AS event
            WHERE event."session_id" = session."id"
        ),
        1
    )
);

ALTER TABLE "events"
ALTER COLUMN "session_id" SET NOT NULL,
ALTER COLUMN "stream_scope" SET DEFAULT 'session',
ALTER COLUMN "domain" SET DEFAULT 'session';

ALTER TABLE "events"
ADD CONSTRAINT "events_session_stream_check"
CHECK ("stream_scope" = 'session' AND "stream_id" = "session_id");

CREATE UNIQUE INDEX "events_stream_scope_stream_id_sequence_key"
ON "events"("stream_scope", "stream_id", "sequence");
