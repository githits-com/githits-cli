import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { CodexReasoningEffort } from "./agent-eval.ts";

const modelProviderSchema = z.strictObject({
  name: z.string().min(1),
  base_url: z.url().refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }),
  env_key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  wire_api: z.literal("responses"),
});

const modelProfileSchema = z.strictObject({
  model: z.string().min(1),
  model_provider: z.string().min(1),
  model_reasoning_effort: z
    .enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    .optional(),
  model_catalog_json: z.string().min(1).optional(),
  model_providers: z.record(z.string(), modelProviderSchema),
});

export interface CodexEvalProfileMetadata {
  path: string;
  sha256: string;
  catalogSha256: string | null;
  provider: string;
}

export interface CodexEvalProfile {
  model: string;
  reasoningEffort?: CodexReasoningEffort;
  envKey: string;
  configArgs: string[];
  metadata: CodexEvalProfileMetadata;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Loads a caller-selected, model-only profile as explicit CLI arguments.
 * Codex's ignore-user-config flag also suppresses native profile loading;
 * decoding a restricted model surface keeps workload isolation intact.
 * Never include TOML parser errors: they can quote inline credentials.
 */
export function loadCodexEvalProfile(path: string): CodexEvalProfile {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new Error("Could not read Codex eval profile");
  }
  let decoded: unknown;
  try {
    decoded = parseToml(contents);
  } catch {
    throw new Error("Could not parse Codex eval profile as TOML");
  }
  const parsed = modelProfileSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      "Codex eval profile must contain only model configuration and an env-key Responses provider",
    );
  }
  const config = parsed.data;
  const provider = config.model_providers[config.model_provider];
  if (!provider) {
    throw new Error("Codex eval profile must define its selected provider");
  }
  const configArgs = [
    "-c",
    `model_provider=${JSON.stringify(config.model_provider)}`,
    "-c",
    // Codex splits dotted override keys literally, including quote characters.
    // One table value preserves TOML key semantics without identifier escaping.
    `model_providers={${JSON.stringify(config.model_provider)}={${Object.entries(
      provider,
    )
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(",")}}}`,
  ];
  let catalogSha256: string | null = null;
  if (config.model_catalog_json) {
    const catalogPath = resolve(dirname(path), config.model_catalog_json);
    try {
      catalogSha256 = sha256(readFileSync(catalogPath, "utf8"));
    } catch {
      throw new Error("Could not read Codex eval profile model catalog");
    }
    configArgs.push("-c", `model_catalog_json=${JSON.stringify(catalogPath)}`);
  }
  return {
    model: config.model,
    reasoningEffort: config.model_reasoning_effort,
    envKey: provider.env_key,
    configArgs,
    metadata: {
      path: resolve(path),
      sha256: sha256(contents),
      catalogSha256,
      provider: config.model_provider,
    },
  };
}
