-- The product surface is task-scoped. Legacy unlinked events cannot be
-- replayed after this migration and are intentionally discarded.
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_task_id_fkey";
DELETE FROM "events" WHERE "task_id" IS NULL;
ALTER TABLE "events" ALTER COLUMN "task_id" SET NOT NULL;
ALTER TABLE "events"
  ADD CONSTRAINT "events_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sandboxes"
  DROP CONSTRAINT IF EXISTS "sandboxes_next_event_sequence_positive";
ALTER TABLE "sandboxes" DROP COLUMN IF EXISTS "next_event_sequence";

DROP INDEX IF EXISTS "sandbox_events_sandbox_id_sequence_key";
DROP INDEX IF EXISTS "sandbox_events_sandbox_id_sequence_idx";
DROP INDEX IF EXISTS "sandbox_events_command_id_sequence_idx";
DROP TABLE IF EXISTS "sandbox_events";
DROP TYPE IF EXISTS "SandboxEventActor";
