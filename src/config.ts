import "dotenv/config";
import { z } from "zod";

const booleanEnv = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean(),
);
const optionalStringEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(10_000),
    SANDBOX_IMAGE: z.string().default("node:22-bookworm"),
    FIXTURE_REPO_PATH: z.string().default("/workspace/fixture-repo"),
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
    SANDBOX_MEMORY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(1073741824),
    SANDBOX_CPUS: z.coerce.number().positive().default(1),
    SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
    SANDBOX_STOP_GRACE_MS: z.coerce.number().int().positive().default(5000),
    COMMAND_OUTPUT_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(10485760),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    AGENT_MODEL: z.string().default("openrouter:deepseek/deepseek-v4-flash"),
    AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(100).default(25),
    AGENT_BASH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
    AGENT_BASH_OUTPUT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(51200),
    AGENT_READ_MAX_BYTES: z.coerce.number().int().min(1024).default(262144),
    AGENT_WRITE_MAX_BYTES: z.coerce.number().int().min(1024).default(1048576),
    AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
    LANGFUSE_ENABLED: booleanEnv.default(false),
    LANGFUSE_PUBLIC_KEY: optionalStringEnv,
    LANGFUSE_SECRET_KEY: optionalStringEnv,
    LANGFUSE_BASE_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    LANGFUSE_FLUSH_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    LOCAL_TRACE_EXPORT_ENABLED: booleanEnv.default(false),
    LOCAL_TRACE_EXPORT_PATH: z
      .string()
      .min(1)
      .default(".data/eval-traces.jsonl"),
    EVAL_TRACE_CONTEXT_SNAPSHOT_ENABLED: booleanEnv.default(false),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV !== "test" && config.OPENROUTER_API_KEY === undefined)
      context.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "OPENROUTER_API_KEY is required outside test mode",
      });
    if (config.LANGFUSE_ENABLED) {
      if (config.LANGFUSE_PUBLIC_KEY === undefined)
        context.addIssue({
          code: "custom",
          path: ["LANGFUSE_PUBLIC_KEY"],
          message: "LANGFUSE_PUBLIC_KEY is required when Langfuse is enabled",
        });
      if (config.LANGFUSE_SECRET_KEY === undefined)
        context.addIssue({
          code: "custom",
          path: ["LANGFUSE_SECRET_KEY"],
          message: "LANGFUSE_SECRET_KEY is required when Langfuse is enabled",
        });
    }
  });

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config =>
  schema.parse(env);
