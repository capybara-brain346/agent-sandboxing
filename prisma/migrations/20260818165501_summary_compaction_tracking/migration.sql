-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "summary_compacted_through_message_count" INTEGER NOT NULL DEFAULT 0;
