import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const profileSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ tools: z.array(z.string().min(1)).min(1) }).strict(),
]);

const profilesSchema = z
  .object({
    profiles: z
      .record(z.string().min(1), profileSchema)
      .refine((profiles) => profiles.main !== undefined, {
        message: 'Tool profile "main" is required',
      })
      .refine((profiles) => profiles.subagent !== undefined, {
        message: 'Tool profile "subagent" is required',
      }),
  })
  .strict();

export type ToolProfile = z.infer<typeof profileSchema>;
export type ToolProfiles = z.infer<typeof profilesSchema>;
export type ToolProfileName = "main" | "subagent";

const PROFILES_PATH = join(
  process.cwd(),
  "src/services/agent/tools/profiles/profiles.yaml",
);

export const parseToolProfiles = (raw: string): ToolProfiles =>
  profilesSchema.parse(parse(raw));

export const loadToolProfiles = (): ToolProfiles =>
  parseToolProfiles(readFileSync(PROFILES_PATH, "utf-8"));

export const getToolProfile = (
  profiles: ToolProfiles,
  name: ToolProfileName,
): ToolProfile => {
  const profile = profiles.profiles[name];
  if (!profile) throw new Error(`Tool profile "${name}" is not configured`);
  return profile;
};

export const validateToolProfiles = (
  profiles: ToolProfiles,
  toolNames: readonly string[],
): void => {
  const availableTools = new Set(toolNames);
  for (const [profileName, profile] of Object.entries(profiles.profiles)) {
    if (!("tools" in profile)) continue;
    for (const toolName of profile.tools)
      if (!availableTools.has(toolName))
        throw new Error(
          `Tool profile "${profileName}" references missing tool "${toolName}"`,
        );
  }
};
