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
const logLevel = z.enum(["debug", "info", "warn", "error"]);
const logColor = z.enum(["auto", "true", "false"]);
const defaultAgentModel = "openrouter:deepseek/deepseek-v4-flash";
const testAuthCookieSecret = "test-auth-cookie-secret-012345678901";
const testTokenEncryptionKey = Buffer.alloc(32).toString("base64");
const testGitHubPrivateKey = "test-github-private-key";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: logLevel.default("info"),
    LOG_COLOR: logColor.default("auto"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(10_000),
    SANDBOX_IMAGE: z.string().default("node:22-bookworm"),
    FIXTURE_REPO_PATH: z.string().default("/workspace/fixture-repo"),
    FIXTURE_REPOS_ENABLED: booleanEnv.default(false),
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
    AGENT_MODEL: z.string().default(defaultAgentModel),
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
    GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .min(1)
      .transform((value) => value.replaceAll("\\n", "\n"))
      .optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_CALLBACK_URL: z.string().url().optional(),
    GITHUB_APP_INSTALL_URL: z.string().url().optional(),
    AUTH_COOKIE_SECRET: z.string().min(32).optional(),
    AUTH_TOKEN_ENCRYPTION_KEY: z
      .string()
      .refine((value) => {
        try {
          return Buffer.from(value, "base64").length === 32;
        } catch {
          return false;
        }
      }, "AUTH_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
      .optional(),
    APP_BASE_URL: z.string().url().optional(),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV !== "test" && config.OPENROUTER_API_KEY === undefined)
      context.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "OPENROUTER_API_KEY is required outside test mode",
      });
    if (config.NODE_ENV === "production" && config.FIXTURE_REPOS_ENABLED)
      context.addIssue({
        code: "custom",
        path: ["FIXTURE_REPOS_ENABLED"],
        message: "FIXTURE_REPOS_ENABLED cannot be enabled in production",
      });
    if (config.NODE_ENV !== "test") {
      const required = [
        "GITHUB_APP_ID",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_CALLBACK_URL",
        "GITHUB_APP_INSTALL_URL",
        "AUTH_COOKIE_SECRET",
        "AUTH_TOKEN_ENCRYPTION_KEY",
        "APP_BASE_URL",
      ] as const;
      for (const key of required)
        if (config[key] === undefined)
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required outside test mode`,
          });
    }
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

type ParsedConfig = z.infer<typeof schema>;
type AuthConfigKey =
  | "GITHUB_APP_ID"
  | "GITHUB_APP_PRIVATE_KEY"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GITHUB_CALLBACK_URL"
  | "GITHUB_APP_INSTALL_URL"
  | "AUTH_COOKIE_SECRET"
  | "AUTH_TOKEN_ENCRYPTION_KEY"
  | "APP_BASE_URL";
type RequiredAuthConfig = {
  [Key in AuthConfigKey]-?: NonNullable<ParsedConfig[Key]>;
};
export type Config = Omit<ParsedConfig, AuthConfigKey> & RequiredAuthConfig;
export type AgentModelConfig = Pick<
  Config,
  "AGENT_MODEL" | "OPENROUTER_API_KEY"
>;

const agentModelSchema = z.object({
  AGENT_MODEL: z.string().default(defaultAgentModel),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
});

export const loadAgentModelConfig = (
  env: NodeJS.ProcessEnv = process.env,
): AgentModelConfig => agentModelSchema.parse(env);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config =>
  schema.parse({
    ...env,
    LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "error" : "info"),
    ...(env.NODE_ENV === "test"
      ? {
          GITHUB_APP_ID: env.GITHUB_APP_ID ?? "1",
          GITHUB_APP_PRIVATE_KEY:
            env.GITHUB_APP_PRIVATE_KEY ?? testGitHubPrivateKey,
          GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID ?? "test-client-id",
          GITHUB_CLIENT_SECRET:
            env.GITHUB_CLIENT_SECRET ?? "test-client-secret",
          GITHUB_CALLBACK_URL:
            env.GITHUB_CALLBACK_URL ??
            "http://localhost:3000/auth/github/callback",
          GITHUB_APP_INSTALL_URL:
            env.GITHUB_APP_INSTALL_URL ??
            "https://github.com/apps/test/installations/new",
          AUTH_COOKIE_SECRET: env.AUTH_COOKIE_SECRET ?? testAuthCookieSecret,
          AUTH_TOKEN_ENCRYPTION_KEY:
            env.AUTH_TOKEN_ENCRYPTION_KEY ?? testTokenEncryptionKey,
          APP_BASE_URL: env.APP_BASE_URL ?? "http://localhost:3000",
        }
      : {}),
  }) as Config;
