TRUNCATE TABLE "events", "artifacts", "chat_messages", "tasks", "sandboxes", "chat_sessions" RESTART IDENTITY CASCADE;

ALTER TABLE "chat_sessions" ADD COLUMN "repo_base_branch" TEXT,
ADD COLUMN "repo_base_sha" TEXT,
ADD COLUMN "user_id" TEXT NOT NULL;

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "github_user_id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "avatar_url" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "github_oauth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token_ciphertext" TEXT NOT NULL,
    "access_token_iv" TEXT NOT NULL,
    "access_token_tag" TEXT NOT NULL,
    "refresh_token_ciphertext" TEXT,
    "refresh_token_iv" TEXT,
    "refresh_token_tag" TEXT,
    "scope" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "github_oauth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "github_installations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_github_user_id_key" ON "users"("github_user_id");
CREATE UNIQUE INDEX "github_oauth_tokens_user_id_key" ON "github_oauth_tokens"("user_id");
CREATE INDEX "github_installations_user_id_idx" ON "github_installations"("user_id");
CREATE UNIQUE INDEX "github_installations_user_id_installation_id_key" ON "github_installations"("user_id", "installation_id");
CREATE INDEX "chat_sessions_user_id_updated_at_idx" ON "chat_sessions"("user_id", "updated_at");

ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_oauth_tokens" ADD CONSTRAINT "github_oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
