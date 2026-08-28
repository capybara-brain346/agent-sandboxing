CREATE TYPE "PullRequestStatus" AS ENUM ('creating', 'open', 'closed', 'failed');

CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "run_id" TEXT,
    "provider" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "number" INTEGER,
    "node_id" TEXT,
    "url" TEXT,
    "branch" TEXT NOT NULL,
    "base_branch" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PullRequestStatus" NOT NULL,
    "draft" BOOLEAN NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pull_requests_session_id_is_current_created_at_idx" ON "pull_requests"("session_id", "is_current", "created_at");
CREATE INDEX "pull_requests_run_id_idx" ON "pull_requests"("run_id");

ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
