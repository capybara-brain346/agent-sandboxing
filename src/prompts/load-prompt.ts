import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const promptSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  updated_at: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
});

export type PromptDefinition = z.infer<typeof promptSchema>;

export type PromptName =
  "orchestrator" | "session-agent" | "session-summary-compactor";

const PROMPTS_DIR = join(process.cwd(), "prompts");

const cache = new Map<PromptName, PromptDefinition>();

export const loadPrompt = (name: PromptName): PromptDefinition => {
  const cached = cache.get(name);
  if (cached) return cached;

  const raw = readFileSync(join(PROMPTS_DIR, `${name}.yaml`), "utf-8");
  const definition = promptSchema.parse(parse(raw));
  if (definition.id !== name) {
    throw new Error(
      `Prompt file ${name}.yaml declares id "${definition.id}", expected "${name}"`,
    );
  }

  cache.set(name, definition);
  return definition;
};

export const getPromptText = (name: PromptName): string =>
  loadPrompt(name).prompt.trim();
