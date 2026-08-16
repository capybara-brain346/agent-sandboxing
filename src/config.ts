import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(10_000),
  SANDBOX_IMAGE: z.string().default("node:22-bookworm"),
  FIXTURE_REPO_PATH: z.string().default("./repo"),
  SANDBOX_PROVISION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  SANDBOX_COMMAND_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(120000),
  SANDBOX_MEMORY_BYTES: z.coerce.number().int().positive().default(1073741824),
  SANDBOX_CPUS: z.coerce.number().positive().default(1),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
  SANDBOX_STOP_GRACE_MS: z.coerce.number().int().positive().default(5000),
  COMMAND_OUTPUT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10485760),
  AGENT_MODEL: z.string().default("openrouter:deepseek/deepseek-v4-flash"),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(25),
  AGENT_BASH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  AGENT_BASH_OUTPUT_MAX_BYTES: z.coerce.number().int().min(1024).default(51200),
  AGENT_READ_MAX_BYTES: z.coerce.number().int().min(1024).default(262144),
  AGENT_WRITE_MAX_BYTES: z.coerce.number().int().min(1024).default(1048576),
  AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config =>
  schema.parse(env);
