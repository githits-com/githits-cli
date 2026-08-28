import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { z } from "zod";

export const AGENT_EVAL_SUITE_NAMES = [
  "canary",
  "smoke",
  "stable-full",
  "stateful-manual",
  "experimental",
] as const;

export type AgentEvalSuiteName = (typeof AGENT_EVAL_SUITE_NAMES)[number];

export const AGENT_EVAL_SAFETY_CLASSES = [
  "stable",
  "stateful",
  "experimental",
] as const;

export type AgentEvalSafetyClass = (typeof AGENT_EVAL_SAFETY_CLASSES)[number];

export const DEFAULT_SUITE_MANIFEST_PATH = resolve("eval/agentic/suites.json");
export const DEFAULT_WORKLOADS_DIR = resolve("eval/agentic/workloads");

const suiteNameSchema = z.enum(AGENT_EVAL_SUITE_NAMES);
const safetyClassSchema = z.enum(AGENT_EVAL_SAFETY_CLASSES);
const workloadIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a stable kebab-case ID");

const suiteWorkloadSchema = z.object({
  id: workloadIdSchema,
  path: z.string().min(1),
  safety: safetyClassSchema,
  suites: z.array(suiteNameSchema).min(1),
});

export const agentEvalSuiteManifestSchema = z.object({
  schemaVersion: z.literal(1),
  workloads: z.array(suiteWorkloadSchema),
});

export type AgentEvalSuiteWorkload = z.infer<typeof suiteWorkloadSchema>;
export type AgentEvalSuiteManifest = z.infer<
  typeof agentEvalSuiteManifestSchema
>;

export interface SuiteValidationOptions {
  repoRoot: string;
  workloadsDir?: string;
}

export interface LoadSuiteManifestOptions extends SuiteValidationOptions {
  manifestPath?: string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

function parseManifest(value: unknown): AgentEvalSuiteManifest {
  const parsed = agentEvalSuiteManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid suite manifest: ${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
}

function isSafeManifestPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function discoveredWorkloadPaths(
  repoRoot: string,
  workloadsDir: string,
): Set<string> {
  if (!existsSync(workloadsDir) || !statSync(workloadsDir).isDirectory()) {
    throw new Error(`workload directory not found: ${workloadsDir}`);
  }
  return new Set(
    readdirSync(workloadsDir)
      .filter((name) => name.endsWith(".md") && name !== "REPORTING.md")
      .filter((name) => statSync(join(workloadsDir, name)).isFile())
      .map((name) =>
        relative(repoRoot, join(workloadsDir, name)).replaceAll("\\", "/"),
      )
      .sort(compareStrings),
  );
}

function assertUniqueValues(
  workloads: AgentEvalSuiteWorkload[],
  field: "id" | "path",
): void {
  const seen = new Set<string>();
  for (const workload of workloads) {
    const value = workload[field];
    if (seen.has(value)) {
      throw new Error(`duplicate workload ${field}: ${value}`);
    }
    seen.add(value);
  }
}

function assertUniqueSuiteMemberships(workload: AgentEvalSuiteWorkload): void {
  if (new Set(workload.suites).size !== workload.suites.length) {
    throw new Error(`duplicate suite membership for workload: ${workload.id}`);
  }
}

function assertSuiteSubset(
  manifest: AgentEvalSuiteManifest,
  subset: AgentEvalSuiteName,
  superset: AgentEvalSuiteName,
): void {
  const supersetIds = new Set(
    manifest.workloads
      .filter((workload) => workload.suites.includes(superset))
      .map((workload) => workload.id),
  );
  for (const workload of manifest.workloads) {
    if (workload.suites.includes(subset) && !supersetIds.has(workload.id)) {
      throw new Error(
        `suite ${subset} must be a subset of ${superset}: ${workload.id}`,
      );
    }
  }
}

function assertSafetyMemberships(manifest: AgentEvalSuiteManifest): void {
  for (const workload of manifest.workloads) {
    const stableSuiteMembership = workload.suites.some((suite) =>
      ["canary", "smoke", "stable-full"].includes(suite),
    );
    if (stableSuiteMembership && workload.safety !== "stable") {
      throw new Error(`non-stable workload in stable suite: ${workload.id}`);
    }
    if (
      workload.safety === "stable" &&
      !workload.suites.includes("stable-full")
    ) {
      throw new Error(
        `stable workload missing stable-full membership: ${workload.id}`,
      );
    }
    if (
      workload.safety === "stateful" &&
      (workload.suites.length !== 1 ||
        !workload.suites.includes("stateful-manual"))
    ) {
      throw new Error(
        `stateful workload must be in only stateful-manual: ${workload.id}`,
      );
    }
    if (
      workload.safety === "experimental" &&
      (workload.suites.length !== 1 ||
        !workload.suites.includes("experimental"))
    ) {
      throw new Error(
        `experimental workload must be in only experimental: ${workload.id}`,
      );
    }
    if (
      workload.safety !== "stateful" &&
      workload.suites.includes("stateful-manual")
    ) {
      throw new Error(
        `stateful-manual contains non-stateful workload: ${workload.id}`,
      );
    }
    if (
      workload.safety !== "experimental" &&
      workload.suites.includes("experimental")
    ) {
      throw new Error(
        `experimental contains non-experimental workload: ${workload.id}`,
      );
    }
  }
}

function assertWorkloadPath(path: string, discovered: Set<string>): void {
  if (!isSafeManifestPath(path)) {
    throw new Error(`unsafe workload path: ${path}`);
  }
  if (extname(path) !== ".md") {
    throw new Error(`manifest workload path is not Markdown: ${path}`);
  }
  if (!discovered.has(path)) {
    throw new Error(
      `manifest workload path is not a discovered workload: ${path}`,
    );
  }
}

/**
 * Validates a parsed suite manifest against the workload files in a checkout.
 * The returned object is safe to pass to suite selection and later execution.
 */
export function validateSuiteManifest(
  value: unknown,
  options: SuiteValidationOptions,
): AgentEvalSuiteManifest {
  const manifest = parseManifest(value);
  const repoRoot = resolve(options.repoRoot);
  const workloadsDir = resolve(
    options.workloadsDir ?? join(repoRoot, "eval/agentic/workloads"),
  );
  const discovered = discoveredWorkloadPaths(repoRoot, workloadsDir);

  assertUniqueValues(manifest.workloads, "id");
  assertUniqueValues(manifest.workloads, "path");
  for (const workload of manifest.workloads) {
    assertUniqueSuiteMemberships(workload);
    assertWorkloadPath(workload.path, discovered);
  }

  const manifestPaths = new Set(
    manifest.workloads.map((workload) => workload.path),
  );
  for (const path of discovered) {
    if (!manifestPaths.has(path)) {
      throw new Error(`discovered workload is unclassified: ${path}`);
    }
  }

  assertSuiteSubset(manifest, "canary", "smoke");
  assertSuiteSubset(manifest, "smoke", "stable-full");
  assertSafetyMemberships(manifest);
  return manifest;
}

export function loadSuiteManifest(
  options: LoadSuiteManifestOptions = {
    repoRoot: resolve("."),
  },
): AgentEvalSuiteManifest {
  const manifestPath = resolve(
    options.manifestPath ?? join(options.repoRoot, "eval/agentic/suites.json"),
  );
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error(`suite manifest not found: ${manifestPath}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`suite manifest is not valid JSON: ${message}`);
  }
  return validateSuiteManifest(value, options);
}

export function selectSuiteWorkloads(
  manifest: AgentEvalSuiteManifest,
  suite: AgentEvalSuiteName,
): AgentEvalSuiteWorkload[] {
  if (!AGENT_EVAL_SUITE_NAMES.includes(suite)) {
    throw new Error(`unknown suite name: ${suite}`);
  }
  return manifest.workloads
    .filter((workload) => workload.suites.includes(suite))
    .toSorted(
      (left, right) =>
        compareStrings(left.id, right.id) ||
        compareStrings(left.path, right.path),
    );
}
