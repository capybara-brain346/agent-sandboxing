-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('created', 'provisioning', 'running', 'completed', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "sandboxes" ADD COLUMN "task_id" TEXT;

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "repo_ref" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "image" TEXT,
    "sandbox_id" TEXT,
    "next_event_sequence" INTEGER NOT NULL DEFAULT 1,
    "diff" TEXT,
    "agent_summary" TEXT,
    "exit_reason" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "provisioning_at" TIMESTAMP(3),
    "running_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "stream_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "producer_service" TEXT NOT NULL,
    "producer_id" TEXT NOT NULL,
    "task_id" TEXT,
    "sandbox_id" TEXT,
    "command_id" TEXT,
    "correlation_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_sandbox_id_key" ON "tasks"("sandbox_id");
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at");
CREATE INDEX "tasks_created_at_idx" ON "tasks"("created_at");
CREATE UNIQUE INDEX "sandboxes_task_id_key" ON "sandboxes"("task_id");

CREATE UNIQUE INDEX "events_stream_id_sequence_key" ON "events"("stream_id", "sequence");
CREATE INDEX "events_stream_id_sequence_idx" ON "events"("stream_id", "sequence");
CREATE INDEX "events_producer_service_producer_id_idx" ON "events"("producer_service", "producer_id");
CREATE INDEX "events_task_id_sequence_idx" ON "events"("task_id", "sequence");
CREATE INDEX "events_sandbox_id_sequence_idx" ON "events"("sandbox_id", "sequence");
CREATE INDEX "events_command_id_sequence_idx" ON "events"("command_id", "sequence");

-- AddForeignKey
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sandbox_id_fkey" FOREIGN KEY ("sandbox_id") REFERENCES "sandboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_sandbox_id_fkey" FOREIGN KEY ("sandbox_id") REFERENCES "sandboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "commands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants used by sequence allocation and task input validation.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_next_event_sequence_positive" CHECK ("next_event_sequence" > 0);
ALTER TABLE "events" ADD CONSTRAINT "events_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repo_ref_nonempty" CHECK (length(trim("repo_ref")) > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_instructions_nonempty" CHECK (length(trim("instructions")) > 0);
