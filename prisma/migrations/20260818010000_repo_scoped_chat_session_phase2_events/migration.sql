-- DropIndex
DROP INDEX "events_stream_id_sequence_key";

-- AlterTable
ALTER TABLE "events" ALTER COLUMN "task_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "events_stream_scope_stream_id_sequence_idx" ON "events"("stream_scope", "stream_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "events_stream_scope_stream_id_sequence_key" ON "events"("stream_scope", "stream_id", "sequence");
