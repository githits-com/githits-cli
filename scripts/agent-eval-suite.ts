import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { z } from "zod";
import {
  collectGitMetadata,
  type GitMetadata,
  loadTargetGuidanceBlock,
  parseArgs,
  runAgentEval,
} from "./agent-eval.ts";
import {
  type AgentEvalMetrics,
  type AgentEvalRecord,
  type EvalScenario,
  GITHITS_INTENT_FRAGMENT_HASH,
  type IntentProfile,
  LUNA_MODEL,
  parseAgentEvalMetrics,
} from "./agent-eval-metrics.ts";
import {
  type AgentEvalReport,
  loadRunReport,
  summarizeCallsByTool,
} from "./agent-eval-report.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

export const AGENT_EVAL_SUITE_PROFILES = ["descriptors", "full"] as const;
export type AgentEvalSuiteProfile = (typeof AGENT_EVAL_SUITE_PROFILES)[number];

export const AGENT_EVAL_SUITE_SCENARIOS = [
  "discovery",
  "intent",
  "full",
] as const satisfies readonly EvalScenario[];
export type AgentEvalSuiteScenario =
  (typeof AGENT_EVAL_SUITE_SCENARIOS)[number];

export interface AgentEvalSuiteScenarioDefinition {
  scenario: AgentEvalSuiteScenario;
  guidanceProfile: AgentEvalSuiteProfile;
  intentProfile: IntentProfile;
  intentFragmentHash: string | null;
}

export const AGENT_EVAL_SUITE_SCENARIO_DEFINITIONS = [
  {
    scenario: "discovery",
    guidanceProfile: "descriptors",
    intentProfile: "neutral",
    intentFragmentHash: null,
  },
  {
    scenario: "intent",
    guidanceProfile: "descriptors",
    intentProfile: "githits",
    intentFragmentHash: GITHITS_INTENT_FRAGMENT_HASH,
  },
  {
    scenario: "full",
    guidanceProfile: "full",
    intentProfile: "neutral",
    intentFragmentHash: null,
  },
] as const satisfies readonly AgentEvalSuiteScenarioDefinition[];

const scenarioDefinition = (
  scenario: AgentEvalSuiteScenario,
): AgentEvalSuiteScenarioDefinition => {
  const definition = AGENT_EVAL_SUITE_SCENARIO_DEFINITIONS.find(
    (candidate) => candidate.scenario === scenario,
  );
  assert(definition, `unknown suite scenario: ${scenario}`);
  return definition;
};

const defaultSuiteScenarios = (
  suite: AgentEvalSuiteName,
): readonly AgentEvalSuiteScenario[] =>
  suite === "canary" ? ["discovery", "intent"] : ["intent"];

export const AGENT_EVAL_SUITE_MATRIX = {
  agent: "codex",
  model: LUNA_MODEL,
  reasoningEffort: "low",
  surface: "mcp",
  server: "local",
} as const;

export const SUITE_MATRIX = AGENT_EVAL_SUITE_MATRIX;

export type AgentEvalSuiteRunStatus =
  | "success"
  | "partial"
  | "failed"
  | "dry-run";

export interface AgentEvalSuiteRunOptions {
  suite: AgentEvalSuiteName;
  repoRoot: string;
  targetRoot?: string;
  outDir: string;
  manifestPath?: string;
  workloadsDir?: string;
  reportingPath?: string;
  schemaPath?: string;
  dryRun?: boolean;
  scenarios?: readonly AgentEvalSuiteScenario[];
  shardExecutor?: AgentEvalSuiteShardExecutor;
}

export interface AgentEvalSuiteShardOptions {
  suite: AgentEvalSuiteName;
  scenario: AgentEvalSuiteScenario;
  profile: AgentEvalSuiteProfile;
  guidanceProfile: AgentEvalSuiteProfile;
  intentProfile: IntentProfile;
  intentFragmentHash: string | null;
  repoRoot: string;
  targetRoot: string;
  outDir: string;
  reportingPath: string;
  schemaPath: string;
  dryRun: boolean;
  experimentalTools: boolean;
  workloads: AgentEvalSuiteWorkload[];
  workloadPaths: string[];
  matrix: typeof AGENT_EVAL_SUITE_MATRIX;
}

export interface AgentEvalSuiteShardExecution {
  runDir?: string;
  runPath?: string;
  metricsPath?: string;
  reportPath?: string;
  status: "success" | "failed";
  error?: string;
}

export type AgentEvalSuiteShardExecutor = (
  options: AgentEvalSuiteShardOptions,
) => Promise<AgentEvalSuiteShardExecution>;

const suiteProfileSchema = z.enum(AGENT_EVAL_SUITE_PROFILES);
const suiteScenarioSchema = z.enum(AGENT_EVAL_SUITE_SCENARIOS);
const suiteGitMetadataSchema = z.object({
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  dirty: z.boolean().nullable(),
});
const fileIdentitySchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
});
const suiteContentIdentitySchema = z.object({
  workloads: z.array(fileIdentitySchema),
  reportingContract: fileIdentitySchema,
  resultSchema: fileIdentitySchema,
});
const targetGuidanceIdentitySchema = z.object({
  skillFiles: z.array(fileIdentitySchema),
  guidanceBlock: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
  }),
});
const suiteTokenTotalsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  cacheWriteInputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningOutputTokens: z.number().int().nonnegative().nullable(),
});
const suiteCostSchema = z.object({
  kind: z.enum(["base_rate_estimate", "unknown"]),
  usd: z.number().nonnegative().nullable(),
  uncertainty: z.enum([
    "rate_based_estimate",
    "long_context_pricing_not_attributable",
    "unknown",
  ]),
});
const suiteCallsByToolSchema = z.object({
  surface: z.enum(["mcp", "cli"]),
  tool: z.string().min(1),
  total: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});
const suiteSelectedWorkloadSchema = z.object({
  id: workloadIdSchema,
  path: z.string().min(1),
  safety: safetyClassSchema,
});
const suiteShardSchema = z.object({
  scenario: suiteScenarioSchema,
  profile: suiteProfileSchema,
  guidanceProfile: suiteProfileSchema,
  intentProfile: z.enum(["neutral", "githits"]),
  intentFragmentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  agent: z.literal("codex"),
  model: z.literal(LUNA_MODEL),
  reasoningEffort: z.literal("low"),
  status: z.enum(["success", "failed"]),
  error: z.string().nullable(),
  runPath: z.string().nullable(),
  metricsPath: z.string().nullable(),
  reportPath: z.string().nullable(),
});
const suiteCellSchema = z.object({
  id: z.string().min(1),
  scenario: suiteScenarioSchema,
  profile: suiteProfileSchema,
  guidanceProfile: suiteProfileSchema,
  intentProfile: z.enum(["neutral", "githits"]),
  intentFragmentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  agent: z.literal("codex"),
  model: z.literal(LUNA_MODEL),
  reasoningEffort: z.literal("low"),
  workloadId: workloadIdSchema,
  workloadPath: z.string().min(1),
  status: z.enum(["success", "failed", "missing", "unknown"]),
  durationMs: z.number().int().nonnegative().nullable(),
});
const suiteTotalsSchema = z.object({
  expectedExecutions: z.number().int().nonnegative(),
  observedExecutions: z.number().int().nonnegative(),
  successfulExecutions: z.number().int().nonnegative(),
  failedExecutions: z.number().int().nonnegative(),
  unknownExecutions: z.number().int().nonnegative(),
  missingExecutions: z.number().int().nonnegative(),
  workloadCount: z.number().int().nonnegative(),
  failedWorkloadCount: z.number().int().nonnegative(),
  missingWorkloadCount: z.number().int().nonnegative(),
});

export const agentEvalSuiteArtifactSchema = z.object({
  schemaVersion: z.literal(2),
  suiteId: z.string().uuid(),
  suiteName: suiteNameSchema,
  status: z.enum(["success", "partial", "failed", "dry-run"]),
  dryRun: z.boolean(),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  measurementRoot: z.string().min(1),
  measurementGit: suiteGitMetadataSchema,
  targetRoot: z.string().min(1),
  targetGit: suiteGitMetadataSchema,
  matrix: z.object({
    agent: z.literal("codex"),
    model: z.literal(LUNA_MODEL),
    reasoningEffort: z.literal("low"),
    surface: z.literal("mcp"),
    server: z.literal("local"),
    scenarios: z.array(suiteScenarioSchema).min(1),
  }),
  selectedWorkloads: z.array(suiteSelectedWorkloadSchema),
  contentIdentity: suiteContentIdentitySchema,
  targetGuidanceIdentity: targetGuidanceIdentitySchema,
  shards: z.array(suiteShardSchema),
  cells: z.array(suiteCellSchema),
  wallTimeMs: z.number().int().nonnegative(),
  cumulativeAgentTimeMs: z.number().int().nonnegative().nullable(),
  totals: suiteTotalsSchema,
  logicalToolCalls: z.number().int().nonnegative().nullable(),
  tokens: suiteTokenTotalsSchema,
  cost: suiteCostSchema,
  callsByTool: z.array(suiteCallsByToolSchema).nullable(),
  missingToolTelemetryCellIds: z.array(z.string().min(1)),
  codexVersions: z.array(z.string().min(1)),
  warnings: z.array(z.string()),
});

export type AgentEvalSuiteArtifact = z.infer<
  typeof agentEvalSuiteArtifactSchema
>;

const suiteV1ShardSchema = z.object({
  profile: suiteProfileSchema,
  status: z.enum(["success", "failed"]),
  error: z.string().nullable(),
  runPath: z.string().nullable(),
  metricsPath: z.string().nullable(),
  reportPath: z.string().nullable(),
});
const suiteV1DescriptorShardSchema = suiteV1ShardSchema.extend({
  profile: z.literal("descriptors"),
});
const suiteV1FullShardSchema = suiteV1ShardSchema.extend({
  profile: z.literal("full"),
});
const suiteV1CellSchema = z.object({
  id: z.string().min(1),
  profile: suiteProfileSchema,
  workloadId: workloadIdSchema,
  workloadPath: z.string().min(1),
  status: z.enum(["success", "failed", "missing", "unknown"]),
  durationMs: z.number().int().nonnegative().nullable(),
});
const suiteV1ArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  suiteId: z.string().uuid(),
  suiteName: suiteNameSchema,
  status: z.enum(["success", "partial", "failed", "dry-run"]),
  dryRun: z.boolean(),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  measurementRoot: z.string().min(1),
  measurementGit: suiteGitMetadataSchema,
  targetRoot: z.string().min(1),
  targetGit: suiteGitMetadataSchema,
  matrix: z.object({
    agent: z.literal("codex"),
    model: z.literal(LUNA_MODEL),
    reasoningEffort: z.literal("low"),
    surface: z.literal("mcp"),
    server: z.literal("local"),
    profiles: z.tuple([z.literal("descriptors"), z.literal("full")]),
  }),
  selectedWorkloads: z.array(suiteSelectedWorkloadSchema),
  contentIdentity: suiteContentIdentitySchema,
  targetGuidanceIdentity: targetGuidanceIdentitySchema,
  shards: z.tuple([suiteV1DescriptorShardSchema, suiteV1FullShardSchema]),
  cells: z.array(suiteV1CellSchema),
  wallTimeMs: z.number().int().nonnegative(),
  cumulativeAgentTimeMs: z.number().int().nonnegative().nullable(),
  totals: suiteTotalsSchema,
  logicalToolCalls: z.number().int().nonnegative().nullable(),
  tokens: suiteTokenTotalsSchema,
  cost: suiteCostSchema,
  callsByTool: z.array(suiteCallsByToolSchema).nullable(),
  missingToolTelemetryCellIds: z.array(z.string().min(1)),
  codexVersions: z.array(z.string().min(1)),
  warnings: z.array(z.string()),
});

function normalizeV1SuiteArtifact(
  value: z.infer<typeof suiteV1ArtifactSchema>,
): AgentEvalSuiteArtifact {
  const scenarioForProfile = (
    profile: AgentEvalSuiteProfile,
  ): AgentEvalSuiteScenario =>
    profile === "descriptors" ? "discovery" : "full";
  const definitionForProfile = (profile: AgentEvalSuiteProfile) =>
    scenarioDefinition(scenarioForProfile(profile));
  const scenarios = [
    ...new Set(value.shards.map((shard) => scenarioForProfile(shard.profile))),
  ];
  const shards = value.shards.map((shard) => {
    const definition = definitionForProfile(shard.profile);
    return {
      ...shard,
      profile: definition.guidanceProfile,
      scenario: definition.scenario,
      guidanceProfile: definition.guidanceProfile,
      intentProfile: definition.intentProfile,
      intentFragmentHash: definition.intentFragmentHash,
      agent: value.matrix.agent,
      model: value.matrix.model,
      reasoningEffort: value.matrix.reasoningEffort,
    };
  });
  const cells = value.cells.map((cell) => {
    const definition = definitionForProfile(cell.profile);
    return {
      ...cell,
      profile: definition.guidanceProfile,
      scenario: definition.scenario,
      id: suiteCellId(definition.scenario, cell.workloadId),
      guidanceProfile: definition.guidanceProfile,
      intentProfile: definition.intentProfile,
      intentFragmentHash: definition.intentFragmentHash,
      agent: value.matrix.agent,
      model: value.matrix.model,
      reasoningEffort: value.matrix.reasoningEffort,
    };
  });
  return agentEvalSuiteArtifactSchema.parse({
    ...value,
    schemaVersion: 2,
    matrix: {
      ...value.matrix,
      scenarios,
    },
    shards,
    cells,
    missingToolTelemetryCellIds: value.missingToolTelemetryCellIds.map((id) => {
      const [profile, ...rest] = id.split("/");
      assert(
        profile === "descriptors" || profile === "full",
        "schema-v1 missing telemetry IDs must use descriptors or full profiles",
      );
      const scenario = scenarioForProfile(profile);
      return [scenario, ...rest].join("/");
    }),
  });
}

export function parseSuiteArtifact(value: unknown): AgentEvalSuiteArtifact {
  const current = agentEvalSuiteArtifactSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = suiteV1ArtifactSchema.safeParse(value);
  if (legacy.success) return normalizeV1SuiteArtifact(legacy.data);
  throw new Error(`Invalid suite artifact: ${formatZodIssues(current.error)}`);
}

export function loadSuiteArtifact(path: string): AgentEvalSuiteArtifact {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Suite artifact is not valid JSON: ${message}`);
  }
  return parseSuiteArtifact(value);
}

function assertDirectory(path: string, description: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${description} directory not found: ${path}`);
  }
}

function normalizedRelativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function assertPathInside(
  root: string,
  path: string,
  description: string,
): void {
  const relativePath = normalizedRelativePath(
    realpathSync(root),
    realpathSync(path),
  );
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("/")
  ) {
    throw new Error(`${description} escapes its root: ${path}`);
  }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileIdentity(
  root: string,
  path: string,
): z.infer<typeof fileIdentitySchema> {
  assert(
    existsSync(path) && statSync(path).isFile(),
    `Required file not found: ${path}`,
  );
  assertPathInside(root, path, "Content identity path");
  const bytes = readFileSync(path);
  return {
    path: normalizedRelativePath(resolve(root), resolve(path)),
    sha256: sha256Bytes(bytes),
    bytes: bytes.byteLength,
  };
}

function skillFileIdentities(
  targetRoot: string,
  skillRoot: string,
): z.infer<typeof fileIdentitySchema>[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unsupported target skill entry: ${path}`);
    }
  };
  visit(skillRoot);
  return files
    .toSorted((left, right) => compareStrings(left, right))
    .map((path) => fileIdentity(targetRoot, path));
}

function suiteCellId(
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
): string {
  return `${scenario}/${workloadId}`;
}

type SuiteCellStatus = "success" | "failed" | "missing" | "unknown";
interface SuiteCell {
  id: string;
  scenario: AgentEvalSuiteScenario;
  profile: AgentEvalSuiteProfile;
  guidanceProfile: AgentEvalSuiteProfile;
  intentProfile: IntentProfile;
  intentFragmentHash: string | null;
  agent: "codex";
  model: typeof LUNA_MODEL;
  reasoningEffort: "low";
  workloadId: string;
  workloadPath: string;
  status: SuiteCellStatus;
  durationMs: number | null;
  record?: AgentEvalRecord;
}

interface ShardEvidence {
  status: "success" | "failed";
  error: string | null;
  runPath: string | null;
  metricsPath: string | null;
  reportPath: string | null;
  metrics?: AgentEvalMetrics;
  report?: AgentEvalReport;
  runMetadata?: Record<string, unknown>;
}

interface SuitePreflight {
  suite: AgentEvalSuiteName;
  repoRoot: string;
  targetRoot: string;
  outDir: string;
  dryRun: boolean;
  manifest: AgentEvalSuiteManifest;
  workloads: AgentEvalSuiteWorkload[];
  workloadPaths: string[];
  reportingPath: string;
  schemaPath: string;
  measurementGit: GitMetadata;
  targetGit: GitMetadata;
  contentIdentity: z.infer<typeof suiteContentIdentitySchema>;
  targetGuidanceIdentity: z.infer<typeof targetGuidanceIdentitySchema>;
}

function pathReference(root: string, path: string | undefined): string | null {
  try {
    if (!path || !existsSync(path) || !statSync(path).isFile()) return null;
    assertPathInside(root, path, "Suite child artifact");
    return normalizedRelativePath(resolve(root), resolve(path));
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasChildWorkloadFailure(
  runMetadata: Record<string, unknown>,
  metrics: AgentEvalMetrics | undefined,
  report: AgentEvalReport | undefined,
): boolean {
  const runWorkloads = Array.isArray(runMetadata.workloads)
    ? runMetadata.workloads
    : [];
  const runFailed = runWorkloads.some(
    (workload) =>
      workload !== null &&
      typeof workload === "object" &&
      ((workload as { status?: unknown }).status === "failed" ||
        (workload as { status?: unknown }).status === "timeout"),
  );
  return (
    runFailed ||
    (metrics?.records.some(
      (record) =>
        record.processStatus === "failed" || record.processStatus === "timeout",
    ) ??
      false) ||
    (report?.workloads.some(
      (workload) =>
        workload.status === "failed" || workload.status === "timeout",
    ) ??
      false)
  );
}

function readShardEvidence(
  suiteRoot: string,
  scenario: AgentEvalSuiteScenario,
  execution: AgentEvalSuiteShardExecution | undefined,
  error: string | null,
): ShardEvidence {
  const defaultRunDir = join(suiteRoot, "shards", scenario);
  const runDir = resolve(suiteRoot, execution?.runDir ?? defaultRunDir);
  if (error) {
    return {
      status: "failed",
      error,
      runPath: null,
      metricsPath: null,
      reportPath: null,
    };
  }
  const runPath = execution?.runPath ?? join(runDir, "run.json");
  const metricsPath = execution?.metricsPath ?? join(runDir, "metrics.json");
  const reportPath = execution?.reportPath ?? join(runDir, "report.json");
  try {
    assertPathInside(suiteRoot, runPath, "Suite child artifact");
    assertPathInside(suiteRoot, metricsPath, "Suite child artifact");
    assertPathInside(suiteRoot, reportPath, "Suite child artifact");
    const resolvedRunPath = pathReference(suiteRoot, runPath);
    const resolvedMetricsPath = pathReference(suiteRoot, metricsPath);
    const resolvedReportPath = pathReference(suiteRoot, reportPath);
    if (!resolvedRunPath)
      throw new Error(`Missing child run.json for ${scenario}`);
    const runValue = JSON.parse(readFileSync(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    const metrics = resolvedMetricsPath
      ? parseAgentEvalMetrics(JSON.parse(readFileSync(metricsPath, "utf8")))
      : undefined;
    const report = resolvedReportPath ? loadRunReport(runDir) : undefined;
    const childWorkloadFailure = hasChildWorkloadFailure(
      runValue,
      metrics,
      report,
    );
    const shardFailed = execution?.status === "failed" || childWorkloadFailure;
    return {
      status: shardFailed ? "failed" : "success",
      error:
        execution?.status === "failed"
          ? (execution.error ?? null)
          : childWorkloadFailure
            ? "one or more child workloads failed"
            : null,
      runPath: resolvedRunPath,
      metricsPath: resolvedMetricsPath,
      reportPath: resolvedReportPath,
      metrics,
      report,
      runMetadata: runValue,
    };
  } catch (caught) {
    return {
      status: "failed",
      error: errorMessage(caught),
      runPath: pathReference(suiteRoot, runPath),
      metricsPath: pathReference(suiteRoot, metricsPath),
      reportPath: pathReference(suiteRoot, reportPath),
    };
  }
}

function buildSuiteCells(
  scenarios: readonly AgentEvalSuiteScenario[],
  workloads: AgentEvalSuiteWorkload[],
  evidence: Map<AgentEvalSuiteScenario, ShardEvidence>,
): SuiteCell[] {
  return scenarios.flatMap((scenario) => {
    const definition = scenarioDefinition(scenario);
    const shard = evidence.get(scenario);
    const records = new Map(
      shard?.metrics?.records.map((record) => [record.workloadId, record]),
    );
    return workloads.map((workload) => {
      const record = records.get(workload.id);
      const reportWorkload = shard?.report?.workloads.find(
        (item) => item.id === workload.id,
      );
      const processStatus = record?.processStatus;
      const status: SuiteCellStatus = !shard?.metrics
        ? "missing"
        : !record
          ? "missing"
          : processStatus === "success" || processStatus === "dry-run"
            ? reportWorkload?.status === "failed" ||
              reportWorkload?.status === "timeout"
              ? "failed"
              : "success"
            : processStatus === "failed" || processStatus === "timeout"
              ? "failed"
              : "unknown";
      return {
        id: suiteCellId(scenario, workload.id),
        scenario,
        profile: definition.guidanceProfile,
        guidanceProfile: definition.guidanceProfile,
        intentProfile: definition.intentProfile,
        intentFragmentHash: definition.intentFragmentHash,
        agent: AGENT_EVAL_SUITE_MATRIX.agent,
        model: AGENT_EVAL_SUITE_MATRIX.model,
        reasoningEffort: AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
        workloadId: workload.id,
        workloadPath: workload.path,
        status,
        durationMs: record?.durationMs ?? null,
        record,
      };
    });
  });
}

function sumCellValues(
  cells: SuiteCell[],
  value: (cell: SuiteCell) => number | null,
): number | null {
  const values = cells.map(value);
  return values.every((item): item is number => item !== null)
    ? values.reduce((total, item) => total + item, 0)
    : null;
}

function tokenTotals(
  cells: SuiteCell[],
): z.infer<typeof suiteTokenTotalsSchema> {
  const values = cells.map((cell) => cell.record?.usage.normalizedTokens);
  const sum = (
    field: keyof NonNullable<(typeof values)[number]>,
  ): number | null => {
    const fieldValues = values.map((item) => item?.[field] ?? null);
    return fieldValues.every((item): item is number => item !== null)
      ? fieldValues.reduce((total, item) => total + item, 0)
      : null;
  };
  return {
    uncachedInputTokens: sum("uncachedInputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningOutputTokens: sum("reasoningOutputTokens"),
  };
}

function costTotals(cells: SuiteCell[]): z.infer<typeof suiteCostSchema> {
  const costs = cells.map((cell) => cell.record?.usage.cost);
  const known = costs.every(
    (
      cost,
    ): cost is Extract<
      NonNullable<typeof cost>,
      { kind: "base_rate_estimate" }
    > => cost?.kind === "base_rate_estimate",
  );
  if (!known) return { kind: "unknown", usd: null, uncertainty: "unknown" };
  const uncertainty = costs.some(
    (cost) => cost.uncertainty === "long_context_pricing_not_attributable",
  )
    ? "long_context_pricing_not_attributable"
    : "rate_based_estimate";
  return {
    kind: "base_rate_estimate",
    usd: costs.reduce((total, cost) => total + cost.usd, 0),
    uncertainty,
  };
}

function aggregateCallsByTool(cells: SuiteCell[]): {
  callsByTool: z.infer<typeof suiteCallsByToolSchema>[] | null;
  missingCellIds: string[];
} {
  const missingCellIds = cells
    .filter((cell) => callsByToolForRecord(cell.record) === null)
    .map((cell) => cell.id);
  if (missingCellIds.length > 0) {
    return { callsByTool: null, missingCellIds };
  }
  const entries = new Map<string, z.infer<typeof suiteCallsByToolSchema>>();
  for (const cell of cells) {
    const calls = callsByToolForRecord(cell.record);
    if (!calls) continue;
    for (const call of calls) {
      const key = `${call.surface}\0${call.tool}`;
      const entry = entries.get(key) ?? {
        surface: call.surface,
        tool: call.tool,
        total: 0,
        started: 0,
        completed: 0,
        failed: 0,
        unknown: 0,
      };
      entry.total += call.total;
      entry.started += call.started;
      entry.completed += call.completed;
      entry.failed += call.failed;
      entry.unknown += call.unknown;
      entries.set(key, entry);
    }
  }
  return {
    callsByTool: [...entries.values()].toSorted(
      (left, right) =>
        compareStrings(left.surface, right.surface) ||
        compareStrings(left.tool, right.tool),
    ),
    missingCellIds,
  };
}

function buildSuiteArtifact(
  preflight: SuitePreflight,
  startedAt: string,
  completedAt: string,
  scenarios: readonly AgentEvalSuiteScenario[],
  evidence: Map<AgentEvalSuiteScenario, ShardEvidence>,
  shardExecutions: Map<
    AgentEvalSuiteScenario,
    AgentEvalSuiteShardExecution | undefined
  >,
  wallTimeMs: number,
): AgentEvalSuiteArtifact {
  const cells = buildSuiteCells(scenarios, preflight.workloads, evidence);
  const successfulExecutions = cells.filter(
    (cell) => cell.status === "success",
  ).length;
  const failedExecutions = cells.filter(
    (cell) => cell.status === "failed",
  ).length;
  const unknownExecutions = cells.filter(
    (cell) => cell.status === "unknown",
  ).length;
  const missingExecutions = cells.filter(
    (cell) => cell.status === "missing",
  ).length;
  const observedExecutions =
    successfulExecutions + failedExecutions + unknownExecutions;
  const failedWorkloads = new Set(
    cells
      .filter((cell) => cell.status === "failed")
      .map((cell) => cell.workloadId),
  );
  const missingWorkloads = new Set(
    cells
      .filter((cell) => cell.status === "missing")
      .map((cell) => cell.workloadId),
  );
  const calls = aggregateCallsByTool(cells);
  const warnings = new Set<string>();
  for (const [scenario, shard] of evidence) {
    if (shard.status === "failed" && shard.error) {
      warnings.add(`${scenario} shard failed: ${shard.error}`);
    }
    for (const warning of shard.metrics?.warnings ?? []) {
      warnings.add(`${scenario} metrics warning: ${warning}`);
    }
    for (const warning of shard.report?.warnings ?? []) {
      warnings.add(`${scenario} report warning: ${warning}`);
    }
  }
  if (calls.missingCellIds.length > 0) {
    warnings.add(
      "logical tool telemetry unavailable for one or more suite cells",
    );
  }
  const executionDurations = sumCellValues(cells, (cell) => cell.durationMs);
  const tokens = tokenTotals(cells);
  const cost = costTotals(cells);
  const codexVersions = new Set<string>();
  for (const shard of evidence.values()) {
    for (const record of shard.metrics?.records ?? []) {
      if (record.agentVersion) codexVersions.add(record.agentVersion);
    }
    const version = shard.runMetadata?.codexVersion;
    if (typeof version === "string" && version.length > 0)
      codexVersions.add(version);
  }
  const shards = scenarios.map((scenario) => {
    const definition = scenarioDefinition(scenario);
    const shard = evidence.get(scenario);
    const execution = shardExecutions.get(scenario);
    return {
      scenario,
      profile: definition.guidanceProfile,
      guidanceProfile: definition.guidanceProfile,
      intentProfile: definition.intentProfile,
      intentFragmentHash: definition.intentFragmentHash,
      agent: AGENT_EVAL_SUITE_MATRIX.agent,
      model: AGENT_EVAL_SUITE_MATRIX.model,
      reasoningEffort: AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
      status: shard?.status ?? "failed",
      error: shard?.error ?? execution?.error ?? null,
      runPath: shard?.runPath ?? null,
      metricsPath: shard?.metricsPath ?? null,
      reportPath: shard?.reportPath ?? null,
    };
  });
  const hasShardFailure = shards.some((shard) => shard.status === "failed");
  const hasCellFailure =
    failedExecutions > 0 || missingExecutions > 0 || unknownExecutions > 0;
  const status: AgentEvalSuiteRunStatus =
    hasShardFailure || hasCellFailure
      ? successfulExecutions > 0
        ? "partial"
        : "failed"
      : preflight.dryRun
        ? "dry-run"
        : "success";
  return parseSuiteArtifact({
    schemaVersion: 2,
    suiteId: randomUUID(),
    suiteName: preflight.suite,
    status,
    dryRun: preflight.dryRun,
    startedAt,
    completedAt,
    measurementRoot: preflight.repoRoot,
    measurementGit: preflight.measurementGit,
    targetRoot: preflight.targetRoot,
    targetGit: preflight.targetGit,
    matrix: {
      ...AGENT_EVAL_SUITE_MATRIX,
      scenarios: [...scenarios],
    },
    selectedWorkloads: preflight.workloads,
    contentIdentity: preflight.contentIdentity,
    targetGuidanceIdentity: preflight.targetGuidanceIdentity,
    shards,
    cells: cells.map(
      ({
        id,
        scenario,
        profile,
        guidanceProfile,
        intentProfile,
        intentFragmentHash,
        agent,
        model,
        reasoningEffort,
        workloadId,
        workloadPath,
        status,
        durationMs,
      }) => ({
        id,
        scenario,
        profile,
        guidanceProfile,
        intentProfile,
        intentFragmentHash,
        agent,
        model,
        reasoningEffort,
        workloadId,
        workloadPath,
        status,
        durationMs,
      }),
    ),
    wallTimeMs,
    cumulativeAgentTimeMs: executionDurations,
    totals: {
      expectedExecutions: cells.length,
      observedExecutions,
      successfulExecutions,
      failedExecutions,
      unknownExecutions,
      missingExecutions,
      workloadCount: preflight.workloads.length,
      failedWorkloadCount: failedWorkloads.size,
      missingWorkloadCount: missingWorkloads.size,
    },
    logicalToolCalls: sumCellValues(
      cells,
      (cell) => cell.record?.tools.logicalCallCount ?? null,
    ),
    tokens,
    cost,
    callsByTool: calls.callsByTool,
    missingToolTelemetryCellIds: calls.missingCellIds,
    codexVersions: [...codexVersions].sort(compareStrings),
    warnings: [...warnings].sort(compareStrings),
  });
}

async function suitePreflight(
  options: AgentEvalSuiteRunOptions,
): Promise<SuitePreflight> {
  const repoRoot = resolve(options.repoRoot);
  const targetRoot = resolve(repoRoot, options.targetRoot ?? repoRoot);
  const outDir = resolve(repoRoot, options.outDir);
  assertDirectory(repoRoot, "Measurement root");
  assertDirectory(targetRoot, "Target root");
  const manifest = loadSuiteManifest({
    manifestPath: options.manifestPath
      ? resolve(repoRoot, options.manifestPath)
      : undefined,
    repoRoot,
    workloadsDir: options.workloadsDir
      ? resolve(repoRoot, options.workloadsDir)
      : undefined,
  });
  const workloads = selectSuiteWorkloads(manifest, options.suite);
  const reportingPath = resolve(
    repoRoot,
    options.reportingPath ?? "eval/agentic/workloads/REPORTING.md",
  );
  const schemaPath = resolve(
    repoRoot,
    options.schemaPath ?? "eval/agentic/result.schema.json",
  );
  assert(
    existsSync(reportingPath) && statSync(reportingPath).isFile(),
    `Reporting contract not found: ${reportingPath}`,
  );
  assert(
    existsSync(schemaPath) && statSync(schemaPath).isFile(),
    `Result schema not found: ${schemaPath}`,
  );
  const skillRoot = join(targetRoot, "skills", "githits-mcp");
  assertDirectory(skillRoot, "Target GitHits skill");
  const guidanceBlock = await loadTargetGuidanceBlock(targetRoot);
  if (options.suite === "stateful-manual" && !options.dryRun) {
    throw new Error("stateful-manual suites are dry-run-only in Phase 2");
  }
  const workloadPaths = workloads.map((workload) =>
    join(repoRoot, workload.path),
  );
  const contentIdentity = {
    workloads: workloadPaths
      .map((path) => fileIdentity(repoRoot, path))
      .toSorted((left, right) => compareStrings(left.path, right.path)),
    reportingContract: fileIdentity(repoRoot, reportingPath),
    resultSchema: fileIdentity(repoRoot, schemaPath),
  };
  const targetGuidanceIdentity = {
    skillFiles: skillFileIdentities(targetRoot, skillRoot),
    guidanceBlock: {
      sha256: sha256Bytes(Buffer.from(guidanceBlock, "utf8")),
      bytes: Buffer.byteLength(guidanceBlock, "utf8"),
    },
  };
  const [measurementGit, targetGit] = await Promise.all([
    collectGitMetadata(repoRoot),
    collectGitMetadata(targetRoot),
  ]);
  return {
    suite: options.suite,
    repoRoot,
    targetRoot,
    outDir,
    dryRun: options.dryRun ?? false,
    manifest,
    workloads,
    workloadPaths,
    reportingPath,
    schemaPath,
    measurementGit,
    targetGit,
    contentIdentity,
    targetGuidanceIdentity,
  };
}

async function productionShardExecutor(
  options: AgentEvalSuiteShardOptions,
): Promise<AgentEvalSuiteShardExecution> {
  const args = [
    "--agent",
    AGENT_EVAL_SUITE_MATRIX.agent,
    "--model",
    AGENT_EVAL_SUITE_MATRIX.model,
    "--reasoning-effort",
    AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
    "--surface",
    AGENT_EVAL_SUITE_MATRIX.surface,
    "--server",
    AGENT_EVAL_SUITE_MATRIX.server,
    "--guidance-profile",
    options.guidanceProfile,
    "--intent-profile",
    options.intentProfile,
    "--target-root",
    options.targetRoot,
    "--out",
    options.outDir,
    "--reporting",
    options.reportingPath,
    "--schema",
    options.schemaPath,
  ];
  if (options.experimentalTools) args.push("--experimental-tools");
  if (options.dryRun) args.push("--dry-run");
  const runnerOptions = parseArgs(args, options.repoRoot);
  runnerOptions.workloads = options.workloadPaths;
  await runAgentEval(runnerOptions);
  return { runDir: options.outDir, status: "success" };
}

/**
 * Runs one named suite with `repoRoot` as the measurement-harness root.
 * `targetRoot` defaults to that root and supplies target launch and guidance
 * content; the harness owns workloads, reporting, schemas, and output. The
 * Configured scenario shards run concurrently and always produce validated suite
 * evidence, including partial or failed child execution. Production execution
 * may invoke paid agents; dry runs and injected shard executors do not.
 */
export async function runAgentEvalSuite(
  options: AgentEvalSuiteRunOptions,
): Promise<AgentEvalSuiteArtifact> {
  const preflight = await suitePreflight(options);
  mkdirSync(preflight.outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const executor = options.shardExecutor ?? productionShardExecutor;
  const scenarios = options.scenarios
    ? [...new Set(options.scenarios)]
    : [...defaultSuiteScenarios(preflight.suite)];
  assert(scenarios.length > 0, "at least one suite scenario is required");
  const shardOptions = scenarios.map((scenario) => {
    const definition = scenarioDefinition(scenario);
    return {
      suite: preflight.suite,
      scenario,
      profile: definition.guidanceProfile,
      guidanceProfile: definition.guidanceProfile,
      intentProfile: definition.intentProfile,
      intentFragmentHash: definition.intentFragmentHash,
      repoRoot: preflight.repoRoot,
      targetRoot: preflight.targetRoot,
      outDir: join(preflight.outDir, "shards", scenario),
      reportingPath: preflight.reportingPath,
      schemaPath: preflight.schemaPath,
      dryRun: preflight.dryRun,
      experimentalTools: preflight.suite === "experimental",
      workloads: preflight.workloads,
      workloadPaths: preflight.workloadPaths,
      matrix: AGENT_EVAL_SUITE_MATRIX,
    };
  });
  const promises = shardOptions.map((shard) =>
    Promise.resolve()
      .then(() => executor(shard))
      .then((execution) => {
        if (!execution) {
          throw new Error("shard executor must return an execution result");
        }
        return execution;
      })
      .catch(
        (error): AgentEvalSuiteShardExecution => ({
          status: "failed",
          error: errorMessage(error),
        }),
      ),
  );
  const executions = await Promise.all(promises);
  const evidence = new Map<AgentEvalSuiteScenario, ShardEvidence>();
  const executionMap = new Map<
    AgentEvalSuiteScenario,
    AgentEvalSuiteShardExecution | undefined
  >();
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    assert(scenario, "missing suite scenario");
    const execution = executions[index];
    executionMap.set(scenario, execution);
    evidence.set(
      scenario,
      readShardEvidence(
        preflight.outDir,
        scenario,
        execution,
        execution?.error ?? null,
      ),
    );
  }
  const completedAt = new Date().toISOString();
  const artifact = buildSuiteArtifact(
    preflight,
    startedAt,
    completedAt,
    scenarios,
    evidence,
    executionMap,
    Date.now() - started,
  );
  writeFileSync(
    join(preflight.outDir, "suite.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  return artifact;
}

export function formatSuiteReport(artifact: AgentEvalSuiteArtifact): string {
  const lines = [
    `Agent eval suite: ${artifact.status} ${artifact.suiteName} ${artifact.measurementRoot}`,
    `matrix=${artifact.matrix.agent}:${artifact.matrix.model}/${artifact.matrix.reasoningEffort} scenarios=${artifact.matrix.scenarios.join(",")} workloads=${artifact.selectedWorkloads.length}`,
    `agentCliVersions=${artifact.codexVersions.length > 0 ? artifact.codexVersions.join(",") : "unknown"}`,
    `totals executions=${artifact.totals.expectedExecutions} observed=${artifact.totals.observedExecutions} succeeded=${artifact.totals.successfulExecutions} failed=${artifact.totals.failedExecutions} missing=${artifact.totals.missingExecutions} wallTimeMs=${artifact.wallTimeMs} cumulativeAgentTimeMs=${artifact.cumulativeAgentTimeMs ?? "unknown"}`,
    `tokens uncachedInput=${artifact.tokens.uncachedInputTokens ?? "unknown"} cachedInput=${artifact.tokens.cachedInputTokens ?? "unknown"} cacheWriteInput=${artifact.tokens.cacheWriteInputTokens ?? "unknown"} output=${artifact.tokens.outputTokens ?? "unknown"} reasoning=${artifact.tokens.reasoningOutputTokens ?? "unknown"}`,
    `cost=${artifact.cost.kind} costUsd=${artifact.cost.usd ?? "unknown"}`,
  ];
  if (artifact.callsByTool === null) {
    lines.push(
      `callsByTool=unknown missingCells=${artifact.missingToolTelemetryCellIds.join(",")}`,
    );
  } else {
    lines.push(
      `callsByTool=${artifact.callsByTool.length === 0 ? "none" : artifact.callsByTool.map((entry) => `${entry.surface}/${entry.tool}(total=${entry.total} started=${entry.started} completed=${entry.completed} failed=${entry.failed} unknown=${entry.unknown})`).join(",")}`,
    );
  }
  for (const shard of artifact.shards) {
    lines.push(
      `shard ${shard.scenario} guidance=${shard.guidanceProfile} intent=${shard.intentProfile} ${shard.status}${shard.error ? ` error=${shard.error}` : ""} run=${shard.runPath ?? "missing"} metrics=${shard.metricsPath ?? "missing"} report=${shard.reportPath ?? "missing"}`,
    );
  }
  for (const warning of artifact.warnings) lines.push(`Warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

const comparisonCellStatusSchema = z.enum([
  "success",
  "failed",
  "missing",
  "unknown",
]);
const comparisonChangeSchema = z.enum([
  "added",
  "removed",
  "changed",
  "unchanged",
  "unknown",
]);
const comparisonMetricSchema = z
  .object({
    before: z.number().nullable(),
    after: z.number().nullable(),
    delta: z.number().nullable(),
    percentChange: z.number().nullable(),
    change: comparisonChangeSchema,
  })
  .strict();
const comparisonStatusSchema = z
  .object({
    before: z.string().nullable(),
    after: z.string().nullable(),
    changed: z.boolean().nullable(),
  })
  .strict();
const comparisonSequenceSchema = z
  .object({
    before: z.array(z.string()).nullable(),
    after: z.array(z.string()).nullable(),
    changed: z.boolean().nullable(),
  })
  .strict();
const comparisonToolDeltaSchema = z
  .object({
    surface: z.enum(["mcp", "cli"]),
    tool: z.string().min(1),
    before: suiteCallsByToolSchema.nullable(),
    after: suiteCallsByToolSchema.nullable(),
    delta: z
      .object({
        total: z.number().int(),
        started: z.number().int(),
        completed: z.number().int(),
        failed: z.number().int(),
        unknown: z.number().int(),
      })
      .strict()
      .nullable(),
    percentChange: z.number().nullable(),
    change: comparisonChangeSchema,
  })
  .strict();
const comparisonCallsByToolSchema = z
  .object({
    before: z.array(suiteCallsByToolSchema).nullable(),
    after: z.array(suiteCallsByToolSchema).nullable(),
    deltas: z.array(comparisonToolDeltaSchema).nullable(),
  })
  .strict();
const comparisonAggregateMetricSchema = comparisonMetricSchema
  .extend({
    includedCellIds: z.array(z.string().min(1)),
    excludedCellIds: z.array(z.string().min(1)),
  })
  .strict();
const comparisonAggregateCallsByToolSchema = comparisonCallsByToolSchema
  .extend({
    includedCellIds: z.array(z.string().min(1)),
    excludedCellIds: z.array(z.string().min(1)),
  })
  .strict();
const comparisonCellSchema = z
  .object({
    id: z.string().min(1),
    scenario: suiteScenarioSchema,
    workloadId: workloadIdSchema,
    workloadPath: z.string().min(1),
    profile: suiteProfileSchema,
    guidanceProfile: suiteProfileSchema,
    intentProfile: z.enum(["neutral", "githits"]),
    intentFragmentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    agent: z.literal("codex"),
    model: z.literal(LUNA_MODEL),
    reasoningEffort: z.literal("low"),
    beforeStatus: comparisonCellStatusSchema.nullable(),
    afterStatus: comparisonCellStatusSchema.nullable(),
    compatibility: z.enum([
      "compatible",
      "incompatible",
      "missing",
      "suppressed",
    ]),
    incompatibilityReason: z.string().nullable(),
    durationMs: comparisonMetricSchema.nullable(),
    logicalToolCalls: comparisonMetricSchema.nullable(),
    tokens: z
      .object({
        uncachedInputTokens: comparisonMetricSchema.nullable(),
        cachedInputTokens: comparisonMetricSchema.nullable(),
        cacheWriteInputTokens: comparisonMetricSchema.nullable(),
        outputTokens: comparisonMetricSchema.nullable(),
        reasoningOutputTokens: comparisonMetricSchema.nullable(),
      })
      .strict(),
    costUsd: comparisonMetricSchema.nullable(),
    callsByTool: comparisonCallsByToolSchema.nullable(),
    toolSequence: comparisonSequenceSchema,
    processStatus: comparisonStatusSchema,
    finalStatus: comparisonStatusSchema,
  })
  .strict();
const comparisonDimensionSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(["compatible", "incompatible", "warning"]),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
const comparisonCompatibilitySchema = z
  .object({
    compatible: z.boolean(),
    directDeltasSuppressed: z.boolean(),
    repositoryOnly: z.boolean(),
    dimensions: z.array(comparisonDimensionSchema),
  })
  .strict();
const comparisonSuiteReferenceSchema = z
  .object({
    suiteId: z.string().uuid(),
    suiteName: suiteNameSchema,
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const comparisonAggregateSchema = z
  .object({
    durationMs: comparisonAggregateMetricSchema,
    logicalToolCalls: comparisonAggregateMetricSchema,
    tokens: z
      .object({
        uncachedInputTokens: comparisonAggregateMetricSchema,
        cachedInputTokens: comparisonAggregateMetricSchema,
        cacheWriteInputTokens: comparisonAggregateMetricSchema,
        outputTokens: comparisonAggregateMetricSchema,
        reasoningOutputTokens: comparisonAggregateMetricSchema,
      })
      .strict(),
    costUsd: comparisonAggregateMetricSchema,
    callsByTool: comparisonAggregateCallsByToolSchema,
  })
  .strict();

export const agentEvalSuiteComparisonSchema = z
  .object({
    schemaVersion: z.literal(2),
    comparisonId: z.string().uuid(),
    mode: z.enum(["live-pair", "offline"]),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1),
    outputDir: z.string().nullable(),
    outputPath: z.string().nullable(),
    baselineSuite: comparisonSuiteReferenceSchema,
    candidateSuite: comparisonSuiteReferenceSchema,
    compatibility: comparisonCompatibilitySchema,
    repositoryOnly: z.boolean(),
    cells: z.array(comparisonCellSchema),
    aggregates: comparisonAggregateSchema,
    warnings: z.array(z.string()),
  })
  .strict();

export type AgentEvalSuiteComparison = z.infer<
  typeof agentEvalSuiteComparisonSchema
>;

interface ImportedSuiteShard {
  runMetadata?: Record<string, unknown>;
  metrics?: AgentEvalMetrics;
  report?: AgentEvalReport;
}

export interface AgentEvalImportedSuite {
  artifact: AgentEvalSuiteArtifact;
  suitePath: string;
  suiteDir: string;
  sha256: string;
  shards: Record<AgentEvalSuiteScenario, ImportedSuiteShard>;
}

function isSafeImportedReference(reference: string): boolean {
  if (
    reference.length === 0 ||
    reference.includes("\\") ||
    isAbsolute(reference) ||
    /^[A-Za-z]:[\\/]/.test(reference)
  ) {
    return false;
  }
  return reference
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

function resolveImportedChild(
  suitePath: string,
  reference: string,
  description: string,
): string {
  assert(
    isSafeImportedReference(reference),
    `${description} must be a safe relative path: ${reference}`,
  );
  const suiteDir = dirname(suitePath);
  const candidate = resolve(suiteDir, reference);
  assert(
    existsSync(candidate) && statSync(candidate).isFile(),
    `${description} not found: ${candidate}`,
  );
  const realSuiteDir = realpathSync(suiteDir);
  const realCandidate = realpathSync(candidate);
  const candidateRelative = normalizedRelativePath(realSuiteDir, realCandidate);
  assert(
    candidateRelative !== "" &&
      candidateRelative !== ".." &&
      !candidateRelative.startsWith("../") &&
      !candidateRelative.startsWith("/"),
    `${description} escapes suite directory: ${reference}`,
  );
  return realCandidate;
}

function readJsonObject(
  path: string,
  description: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${description} is not valid JSON: ${errorMessage(error)}`);
  }
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be a JSON object`,
  );
  return value as Record<string, unknown>;
}

function validateImportedSuiteArtifact(artifact: AgentEvalSuiteArtifact): void {
  assert(
    new Set(artifact.matrix.scenarios).size ===
      artifact.matrix.scenarios.length,
    "Suite artifact matrix scenarios must be unique",
  );
  assert(
    artifact.shards.length === artifact.matrix.scenarios.length,
    "Suite artifact must contain exactly one shard per scenario",
  );
  const shardScenarios = new Set<AgentEvalSuiteScenario>();
  for (const shard of artifact.shards) {
    assert(
      !shardScenarios.has(shard.scenario),
      `Suite artifact has duplicate scenario shard: ${shard.scenario}`,
    );
    assert(
      artifact.matrix.scenarios.includes(shard.scenario),
      `Suite artifact shard references unselected scenario: ${shard.scenario}`,
    );
    shardScenarios.add(shard.scenario);
  }
  for (const scenario of artifact.matrix.scenarios) {
    assert(
      shardScenarios.has(scenario),
      `Suite artifact is missing scenario shard: ${scenario}`,
    );
  }
  const selectedIds = new Set<string>();
  const selectedPaths = new Set<string>();
  for (const workload of artifact.selectedWorkloads) {
    assert(
      !selectedIds.has(workload.id),
      `Suite artifact has duplicate selected workload ID: ${workload.id}`,
    );
    assert(
      !selectedPaths.has(workload.path),
      `Suite artifact has duplicate selected workload path: ${workload.path}`,
    );
    selectedIds.add(workload.id);
    selectedPaths.add(workload.path);
  }

  const identityPaths = new Set<string>();
  assert(
    artifact.contentIdentity.workloads.length ===
      artifact.selectedWorkloads.length,
    "Suite artifact workload content identities must match selected workloads",
  );
  for (const identity of artifact.contentIdentity.workloads) {
    assert(
      !identityPaths.has(identity.path),
      `Suite artifact has duplicate workload content identity: ${identity.path}`,
    );
    assert(
      selectedPaths.has(identity.path),
      `Suite artifact has workload content identity not selected: ${identity.path}`,
    );
    identityPaths.add(identity.path);
  }
  for (const path of selectedPaths) {
    assert(
      identityPaths.has(path),
      `Suite artifact is missing workload content identity: ${path}`,
    );
  }

  const expectedCells = new Set(
    artifact.matrix.scenarios.flatMap((scenario) =>
      [...selectedIds].map((workloadId) => suiteCellId(scenario, workloadId)),
    ),
  );
  assert(
    artifact.cells.length === expectedCells.size,
    "Suite artifact cells must contain exactly one cell per scenario/workload",
  );
  const cellIds = new Set<string>();
  for (const cell of artifact.cells) {
    assert(
      !cellIds.has(cell.id),
      `Suite artifact has duplicate cell: ${cell.id}`,
    );
    assert(
      selectedIds.has(cell.workloadId),
      `Suite artifact cell references unselected workload: ${cell.workloadId}`,
    );
    const selected = artifact.selectedWorkloads.find(
      (workload) => workload.id === cell.workloadId,
    );
    assert(
      selected,
      `Suite artifact cell workload is missing: ${cell.workloadId}`,
    );
    assert(
      cell.id === suiteCellId(cell.scenario, cell.workloadId),
      `Suite artifact cell has incorrect ID: ${cell.id}`,
    );
    assert(
      cell.workloadPath === selected.path,
      `Suite artifact cell has incorrect workload path: ${cell.id}`,
    );
    assert(
      artifact.matrix.scenarios.includes(cell.scenario),
      `Suite artifact cell references unselected scenario: ${cell.scenario}`,
    );
    cellIds.add(cell.id);
  }
  for (const cellId of expectedCells) {
    assert(cellIds.has(cellId), `Suite artifact is missing cell: ${cellId}`);
  }
}

function validateImportedMetricsRecords(
  artifact: AgentEvalSuiteArtifact,
  scenario: AgentEvalSuiteScenario,
  metrics: AgentEvalMetrics | undefined,
  report: AgentEvalReport | undefined,
): void {
  const selectedIds = new Set(
    artifact.selectedWorkloads.map((workload) => workload.id),
  );
  const recordIds = new Set<string>();
  for (const record of metrics?.records ?? []) {
    assert(
      !recordIds.has(record.workloadId),
      `Suite artifact has duplicate ${scenario} metrics workload ID: ${record.workloadId}`,
    );
    assert(
      selectedIds.has(record.workloadId),
      `Suite artifact ${scenario} metrics references unselected workload: ${record.workloadId}`,
    );
    recordIds.add(record.workloadId);
  }
  for (const cell of artifact.cells.filter(
    (candidate) => candidate.scenario === scenario,
  )) {
    const record = metrics?.records.find(
      (candidate) => candidate.workloadId === cell.workloadId,
    );
    const reportWorkload = report?.workloads.find(
      (candidate) => candidate.id === cell.workloadId,
    );
    const expectedStatus: SuiteCellStatus = !metrics
      ? "missing"
      : !record
        ? "missing"
        : record.processStatus === "success" ||
            record.processStatus === "dry-run"
          ? reportWorkload?.status === "failed" ||
            reportWorkload?.status === "timeout"
            ? "failed"
            : "success"
          : record.processStatus === "failed" ||
              record.processStatus === "timeout"
            ? "failed"
            : "unknown";
    assert(
      cell.status === expectedStatus,
      `Suite artifact cell status does not match ${scenario} child evidence: ${cell.id} expected=${expectedStatus} actual=${cell.status}`,
    );
  }
}

function resolveImportedReportReferences(
  suitePath: string,
  scenario: AgentEvalSuiteScenario,
  runReference: string | null,
  metricsReference: string | null,
  reportReference: string,
): { runPath: string; metricsPath: string; reportPath: string } {
  assert(
    runReference !== null && metricsReference !== null,
    `${scenario} report.json requires run.json and metrics.json references`,
  );
  const runPath = resolveImportedChild(
    suitePath,
    runReference,
    `${scenario} run.json`,
  );
  const metricsPath = resolveImportedChild(
    suitePath,
    metricsReference,
    `${scenario} metrics.json`,
  );
  const reportPath = resolveImportedChild(
    suitePath,
    reportReference,
    `${scenario} report.json`,
  );
  assert(
    basename(runPath) === "run.json" &&
      basename(metricsPath) === "metrics.json" &&
      basename(reportPath) === "report.json",
    `${scenario} child references must use canonical run.json, metrics.json, and report.json basenames`,
  );
  const runParent = realpathSync(dirname(runPath));
  const metricsParent = realpathSync(dirname(metricsPath));
  const reportParent = realpathSync(dirname(reportPath));
  assert(
    runParent === metricsParent && runParent === reportParent,
    `${scenario} run.json, metrics.json, and report.json must share one contained directory`,
  );
  return { runPath, metricsPath, reportPath };
}

export function loadImportedSuite(path: string): AgentEvalImportedSuite {
  const suitePath = resolve(path);
  assert(
    existsSync(suitePath) && statSync(suitePath).isFile(),
    `Suite artifact not found: ${suitePath}`,
  );
  const suiteBytes = readFileSync(suitePath);
  const artifact = parseSuiteArtifact(JSON.parse(suiteBytes.toString("utf8")));
  validateImportedSuiteArtifact(artifact);
  const shards = {} as Record<AgentEvalSuiteScenario, ImportedSuiteShard>;
  for (const scenario of artifact.matrix.scenarios) {
    const shard = artifact.shards.find((item) => item.scenario === scenario);
    assert(shard, `Suite artifact is missing ${scenario} shard`);
    const imported: ImportedSuiteShard = {};
    const reportReferences = shard.reportPath
      ? resolveImportedReportReferences(
          suitePath,
          scenario,
          shard.runPath,
          shard.metricsPath,
          shard.reportPath,
        )
      : null;
    if (shard.runPath) {
      const runPath =
        reportReferences?.runPath ??
        resolveImportedChild(suitePath, shard.runPath, `${scenario} run.json`);
      imported.runMetadata = readJsonObject(runPath, `${scenario} run.json`);
    }
    if (shard.metricsPath) {
      const metricsPath =
        reportReferences?.metricsPath ??
        resolveImportedChild(
          suitePath,
          shard.metricsPath,
          `${scenario} metrics.json`,
        );
      imported.metrics = parseAgentEvalMetrics(
        readJsonObject(metricsPath, `${scenario} metrics.json`),
      );
    }
    if (shard.reportPath) {
      assert(reportReferences, `Missing ${scenario} report references`);
      const reportPath = reportReferences.reportPath;
      imported.report = loadRunReport(dirname(reportPath));
    }
    validateImportedMetricsRecords(
      artifact,
      scenario,
      imported.metrics,
      imported.report,
    );
    shards[scenario] = imported;
  }
  return {
    artifact,
    suitePath,
    suiteDir: dirname(suitePath),
    sha256: sha256Bytes(suiteBytes),
    shards,
  };
}

export const loadSuiteForComparison = loadImportedSuite;

interface ComparisonCellSource {
  cell?: AgentEvalSuiteArtifact["cells"][number];
  record?: AgentEvalRecord;
}

function suiteCellSource(
  suite: AgentEvalImportedSuite,
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
): ComparisonCellSource {
  const child = suite.shards[scenario];
  return {
    cell: suite.artifact.cells.find(
      (candidate) =>
        candidate.scenario === scenario && candidate.workloadId === workloadId,
    ),
    record: child?.metrics?.records.find(
      (candidate) => candidate.workloadId === workloadId,
    ),
  };
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparisonDimension(
  name: string,
  before: unknown,
  after: unknown,
  reason = "values differ",
): z.infer<typeof comparisonDimensionSchema> {
  return {
    name,
    status: equalValue(before, after) ? "compatible" : "incompatible",
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    reason: equalValue(before, after) ? null : reason,
  };
}

function warningDimension(
  name: string,
  before: unknown,
  after: unknown,
  reason: string,
): z.infer<typeof comparisonDimensionSchema> {
  return {
    name,
    status: "warning",
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    reason,
  };
}

function numericDelta(
  before: number | null,
  after: number | null,
): z.infer<typeof comparisonMetricSchema> {
  if (before === null || after === null) {
    return {
      before,
      after,
      delta: null,
      percentChange: null,
      change: "unknown",
    };
  }
  const delta = after - before;
  const change =
    before === 0 && after > 0
      ? "added"
      : before > 0 && after === 0
        ? "removed"
        : delta === 0
          ? "unchanged"
          : "changed";
  return {
    before,
    after,
    delta,
    percentChange: before === 0 ? null : (delta / before) * 100,
    change,
  };
}

function sequenceForRecord(
  record: AgentEvalRecord | undefined,
): string[] | null {
  return record
    ? record.tools.sequence.map(
        (call) => `${call.surface}/${call.tool}:${call.status}`,
      )
    : null;
}

function statusComparison(
  before: string | null,
  after: string | null,
): z.infer<typeof comparisonStatusSchema> {
  return {
    before,
    after,
    changed: before === null || after === null ? null : before !== after,
  };
}

function sequenceComparison(
  before: string[] | null,
  after: string[] | null,
): z.infer<typeof comparisonSequenceSchema> {
  return {
    before,
    after,
    changed:
      before === null || after === null ? null : !equalValue(before, after),
  };
}

function callsByToolForRecord(
  record: AgentEvalRecord | undefined,
): z.infer<typeof suiteCallsByToolSchema>[] | null {
  if (!record) return null;
  return summarizeCallsByTool(
    record.tools.sequence,
    record.tools.logicalCallCount,
  );
}

type ToolCounts = Pick<
  z.infer<typeof suiteCallsByToolSchema>,
  "total" | "started" | "completed" | "failed" | "unknown"
>;

function toolCountDelta(
  before: z.infer<typeof suiteCallsByToolSchema> | null,
  after: z.infer<typeof suiteCallsByToolSchema> | null,
): z.infer<typeof comparisonToolDeltaSchema> {
  const zero: ToolCounts = {
    total: 0,
    started: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
  };
  const beforeCounts = before ?? zero;
  const afterCounts = after ?? zero;
  const delta = {
    total: afterCounts.total - beforeCounts.total,
    started: afterCounts.started - beforeCounts.started,
    completed: afterCounts.completed - beforeCounts.completed,
    failed: afterCounts.failed - beforeCounts.failed,
    unknown: afterCounts.unknown - beforeCounts.unknown,
  };
  const statusCountsChanged =
    delta.started !== 0 ||
    delta.completed !== 0 ||
    delta.failed !== 0 ||
    delta.unknown !== 0;
  const change =
    before === null && after !== null
      ? "added"
      : before !== null && after === null
        ? "removed"
        : !statusCountsChanged
          ? "unchanged"
          : "changed";
  return {
    surface: after?.surface ?? before?.surface ?? "mcp",
    tool: after?.tool ?? before?.tool ?? "unknown",
    before,
    after,
    delta,
    percentChange:
      beforeCounts.total === 0
        ? null
        : (delta.total / beforeCounts.total) * 100,
    change,
  };
}

function callsComparison(
  before: z.infer<typeof suiteCallsByToolSchema>[] | null,
  after: z.infer<typeof suiteCallsByToolSchema>[] | null,
): z.infer<typeof comparisonCallsByToolSchema> {
  if (before === null || after === null) {
    return { before, after, deltas: null };
  }
  const beforeByKey = new Map(
    before.map((entry) => [`${entry.surface}\0${entry.tool}`, entry]),
  );
  const afterByKey = new Map(
    after.map((entry) => [`${entry.surface}\0${entry.tool}`, entry]),
  );
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort(
    compareStrings,
  );
  return {
    before,
    after,
    deltas: keys.map((key) =>
      toolCountDelta(beforeByKey.get(key) ?? null, afterByKey.get(key) ?? null),
    ),
  };
}

function recordDimensionMismatch(
  before: AgentEvalRecord,
  after: AgentEvalRecord,
  scenario: AgentEvalSuiteScenario,
): string | null {
  const dimensions: Array<[string, unknown, unknown]> = [
    ["agent", before.agent, after.agent],
    ["requestedModel", before.requestedModel, after.requestedModel],
    ["resolvedModel", before.resolvedModel, after.resolvedModel],
    ["reasoningEffort", before.reasoningEffort, after.reasoningEffort],
    ["surface", before.surface, after.surface],
    ["server", before.server, after.server],
    ["experimentalTools", before.experimentalTools, after.experimentalTools],
    ["publishedPackage", before.publishedPackage, after.publishedPackage],
    ["guidanceProfile", before.guidanceProfile, after.guidanceProfile],
    ["scenario", before.scenario, after.scenario],
    ["intentProfile", before.intentProfile, after.intentProfile],
    ["intentFragmentHash", before.intentFragmentHash, after.intentFragmentHash],
  ];
  for (const [name, beforeValue, afterValue] of dimensions) {
    if (!equalValue(beforeValue, afterValue)) return name;
  }
  if (before.scenario !== scenario || after.scenario !== scenario) {
    return "scenario";
  }
  return null;
}

function workloadIdentity(
  suite: AgentEvalImportedSuite,
  workloadId: string,
): { path: string; sha256: string } | null {
  const workload = suite.artifact.selectedWorkloads.find(
    (candidate) => candidate.id === workloadId,
  );
  if (!workload) return null;
  const identity = suite.artifact.contentIdentity.workloads.find(
    (candidate) => candidate.path === workload.path,
  );
  return identity ? { path: identity.path, sha256: identity.sha256 } : null;
}

function workloadPath(
  before: AgentEvalImportedSuite,
  after: AgentEvalImportedSuite,
  workloadId: string,
): string {
  return (
    after.artifact.selectedWorkloads.find((item) => item.id === workloadId)
      ?.path ??
    before.artifact.selectedWorkloads.find((item) => item.id === workloadId)
      ?.path ??
    workloadId
  );
}

function allCellKeys(
  before: AgentEvalImportedSuite,
  after: AgentEvalImportedSuite,
): Array<{ scenario: AgentEvalSuiteScenario; workloadId: string }> {
  const keys = new Set<string>();
  for (const suite of [before, after]) {
    for (const cell of suite.artifact.cells) {
      keys.add(`${cell.scenario}\0${cell.workloadId}`);
    }
  }
  const scenarioOrder = new Map(
    AGENT_EVAL_SUITE_SCENARIOS.map((scenario, index) => [scenario, index]),
  );
  return [...keys]
    .sort((left, right) => {
      const leftScenario = left.split("\0")[0] as AgentEvalSuiteScenario;
      const rightScenario = right.split("\0")[0] as AgentEvalSuiteScenario;
      return (
        (scenarioOrder.get(leftScenario) ?? Number.MAX_SAFE_INTEGER) -
          (scenarioOrder.get(rightScenario) ?? Number.MAX_SAFE_INTEGER) ||
        compareStrings(left, right)
      );
    })
    .map((key) => {
      const [scenario, workloadId] = key.split("\0");
      assert(
        scenario !== undefined && workloadId !== undefined,
        `invalid suite cell key: ${key}`,
      );
      return {
        scenario: scenario as AgentEvalSuiteScenario,
        workloadId,
      };
    });
}

function compatibleCellMetric(
  before: ComparisonCellSource,
  after: ComparisonCellSource,
  globalSuppressed: boolean,
  workloadMismatch: boolean,
  scenario: AgentEvalSuiteScenario,
): boolean {
  return (
    !globalSuppressed &&
    !workloadMismatch &&
    before.cell?.status === "success" &&
    after.cell?.status === "success" &&
    before.record !== undefined &&
    after.record !== undefined &&
    (before.record.processStatus === "success" ||
      before.record.processStatus === "dry-run") &&
    (after.record.processStatus === "success" ||
      after.record.processStatus === "dry-run") &&
    recordDimensionMismatch(before.record, after.record, scenario) === null
  );
}

function metricForCell(
  beforeValue: number | null,
  afterValue: number | null,
  eligible: boolean,
): z.infer<typeof comparisonMetricSchema> | null {
  if (!eligible) return null;
  return numericDelta(beforeValue, afterValue);
}

function aggregateMetric(
  cells: Array<{
    id: string;
    eligible: boolean;
    before: number | null;
    after: number | null;
  }>,
): z.infer<typeof comparisonAggregateMetricSchema> {
  const includedCellIds = cells
    .filter(
      (cell) => cell.eligible && cell.before !== null && cell.after !== null,
    )
    .map((cell) => cell.id);
  const excludedCellIds = cells
    .filter(
      (cell) => !cell.eligible || cell.before === null || cell.after === null,
    )
    .map((cell) => cell.id);
  const before = includedCellIds.length
    ? cells
        .filter((cell) => includedCellIds.includes(cell.id))
        .reduce((sum, cell) => sum + (cell.before ?? 0), 0)
    : null;
  const after = includedCellIds.length
    ? cells
        .filter((cell) => includedCellIds.includes(cell.id))
        .reduce((sum, cell) => sum + (cell.after ?? 0), 0)
    : null;
  return {
    ...numericDelta(before, after),
    includedCellIds,
    excludedCellIds,
  };
}

function aggregateToolCalls(
  cells: Array<{
    id: string;
    eligible: boolean;
    before: z.infer<typeof suiteCallsByToolSchema>[] | null;
    after: z.infer<typeof suiteCallsByToolSchema>[] | null;
  }>,
): z.infer<typeof comparisonAggregateCallsByToolSchema> {
  const includedCellIds = cells
    .filter(
      (cell) => cell.eligible && cell.before !== null && cell.after !== null,
    )
    .map((cell) => cell.id);
  const excludedCellIds = cells
    .filter(
      (cell) => !cell.eligible || cell.before === null || cell.after === null,
    )
    .map((cell) => cell.id);
  if (includedCellIds.length === 0) {
    return {
      before: null,
      after: null,
      deltas: null,
      includedCellIds,
      excludedCellIds,
    };
  }
  const beforeEntries = new Map<
    string,
    z.infer<typeof suiteCallsByToolSchema>
  >();
  const afterEntries = new Map<
    string,
    z.infer<typeof suiteCallsByToolSchema>
  >();
  for (const cell of cells) {
    if (!includedCellIds.includes(cell.id)) continue;
    for (const side of [
      [cell.before, beforeEntries],
      [cell.after, afterEntries],
    ] as const) {
      for (const entry of side[0] ?? []) {
        const key = `${entry.surface}\0${entry.tool}`;
        const current = side[1].get(key) ?? {
          ...entry,
          total: 0,
          started: 0,
          completed: 0,
          failed: 0,
          unknown: 0,
        };
        current.total += entry.total;
        current.started += entry.started;
        current.completed += entry.completed;
        current.failed += entry.failed;
        current.unknown += entry.unknown;
        side[1].set(key, current);
      }
    }
  }
  const before = [...beforeEntries.values()].toSorted(
    (left, right) =>
      compareStrings(left.surface, right.surface) ||
      compareStrings(left.tool, right.tool),
  );
  const after = [...afterEntries.values()].toSorted(
    (left, right) =>
      compareStrings(left.surface, right.surface) ||
      compareStrings(left.tool, right.tool),
  );
  return {
    before,
    after,
    deltas: callsComparison(before, after).deltas,
    includedCellIds,
    excludedCellIds,
  };
}

function matrixDimensions(
  before: AgentEvalSuiteArtifact,
  after: AgentEvalSuiteArtifact,
): z.infer<typeof comparisonDimensionSchema>[] {
  const dimensions: z.infer<typeof comparisonDimensionSchema>[] = [];
  for (const name of [
    "agent",
    "model",
    "reasoningEffort",
    "surface",
    "server",
  ] as const) {
    dimensions.push(
      comparisonDimension(
        `matrix.${name}`,
        before.matrix[name],
        after.matrix[name],
        `matrix ${name} differs`,
      ),
    );
  }
  dimensions.push(
    comparisonDimension(
      "matrix.scenarios",
      before.matrix.scenarios,
      after.matrix.scenarios,
      "matrix scenarios differ",
    ),
    comparisonDimension(
      "suiteName",
      before.suiteName,
      after.suiteName,
      "suite names differ",
    ),
    comparisonDimension(
      "dryRun",
      before.dryRun,
      after.dryRun,
      "execution modes differ",
    ),
    comparisonDimension(
      "reportingContract",
      before.contentIdentity.reportingContract,
      after.contentIdentity.reportingContract,
      "reporting contract content differs",
    ),
    comparisonDimension(
      "resultSchema",
      before.contentIdentity.resultSchema,
      after.contentIdentity.resultSchema,
      "result schema content differs",
    ),
  );
  const targetDimension = (
    name: string,
    beforeValue: unknown,
    afterValue: unknown,
  ): z.infer<typeof comparisonDimensionSchema> =>
    equalValue(beforeValue, afterValue)
      ? comparisonDimension(name, beforeValue, afterValue)
      : warningDimension(
          name,
          beforeValue,
          afterValue,
          "target change is an intended comparison dimension",
        );
  dimensions.push(
    targetDimension("targetGit", before.targetGit, after.targetGit),
    targetDimension(
      "targetGuidance",
      before.targetGuidanceIdentity,
      after.targetGuidanceIdentity,
    ),
  );
  const harnessGitEqual = equalValue(
    before.measurementGit,
    after.measurementGit,
  );
  if (!harnessGitEqual) {
    dimensions.push(
      warningDimension(
        "measurementGit",
        before.measurementGit,
        after.measurementGit,
        "measurement harness Git identity differs",
      ),
    );
  } else {
    dimensions.push(
      comparisonDimension(
        "measurementGit",
        before.measurementGit,
        after.measurementGit,
      ),
    );
  }
  const beforeVersions = [...before.codexVersions].sort(compareStrings);
  const afterVersions = [...after.codexVersions].sort(compareStrings);
  if (!equalValue(beforeVersions, afterVersions)) {
    dimensions.push(
      warningDimension(
        "codexVersion",
        beforeVersions,
        afterVersions,
        "Codex CLI version differs",
      ),
    );
  } else {
    dimensions.push(
      comparisonDimension("codexVersion", beforeVersions, afterVersions),
    );
  }
  return dimensions;
}

function workloadContentMismatch(
  before: AgentEvalImportedSuite,
  after: AgentEvalImportedSuite,
  workloadId: string,
): boolean {
  const beforeIdentity = workloadIdentity(before, workloadId);
  const afterIdentity = workloadIdentity(after, workloadId);
  return (
    beforeIdentity === null ||
    afterIdentity === null ||
    !equalValue(beforeIdentity, afterIdentity)
  );
}

function comparisonWarnings(
  dimensions: z.infer<typeof comparisonDimensionSchema>[],
  workloadMismatches: string[],
): string[] {
  const warnings = dimensions
    .filter((dimension) => dimension.status !== "compatible")
    .map(
      (dimension) =>
        `${dimension.name}: ${dimension.reason ?? dimension.status}`,
    );
  warnings.push(
    ...workloadMismatches.map(
      (workloadId) =>
        `workload ${workloadId}: workload content identity differs; direct deltas excluded`,
    ),
  );
  return [...new Set(warnings)].sort(compareStrings);
}

function gitAttributionIssues(git: GitMetadata): string[] {
  const issues: string[] = [];
  if (git.dirty === true) issues.push("dirty checkout");
  if (git.dirty === null) issues.push("dirty state unknown");
  if (git.sha === null || git.sha.trim() === "")
    issues.push("commit SHA unavailable");
  return issues;
}

function gitAttributionWarnings(
  side: "baseline" | "candidate",
  kind: "measurementGit" | "targetGit",
  git: GitMetadata,
): string[] {
  const issues = gitAttributionIssues(git);
  return issues.length > 0
    ? [
        `repositoryOnly=false: ${side} ${kind} has ${issues.join(" and ")}; attribution is not clean`,
      ]
    : [];
}

function metricValue(
  record: AgentEvalRecord | undefined,
  key:
    | "uncachedInputTokens"
    | "cachedInputTokens"
    | "cacheWriteInputTokens"
    | "outputTokens"
    | "reasoningOutputTokens",
): number | null {
  return record?.usage.normalizedTokens[key] ?? null;
}

function costValue(record: AgentEvalRecord | undefined): number | null {
  return record?.usage.cost.kind === "base_rate_estimate"
    ? record.usage.cost.usd
    : null;
}

function cellCompatibilityReason(
  before: ComparisonCellSource,
  after: ComparisonCellSource,
  scenario: AgentEvalSuiteScenario,
  globalSuppressed: boolean,
  workloadMismatch: boolean,
): {
  compatibility: "compatible" | "incompatible" | "missing" | "suppressed";
  reason: string | null;
} {
  if (!before.cell || !after.cell || !before.record || !after.record) {
    return {
      compatibility: "missing",
      reason:
        !before.cell || !before.record ? "missing_before" : "missing_after",
    };
  }
  if (globalSuppressed) {
    return { compatibility: "suppressed", reason: "global_delta_suppression" };
  }
  if (workloadMismatch) {
    return {
      compatibility: "incompatible",
      reason: "workload_content_mismatch",
    };
  }
  const cellIdentity = [
    ["scenario", before.cell.scenario, after.cell.scenario],
    [
      "guidanceProfile",
      before.cell.guidanceProfile,
      after.cell.guidanceProfile,
    ],
    ["intentProfile", before.cell.intentProfile, after.cell.intentProfile],
    [
      "intentFragmentHash",
      before.cell.intentFragmentHash,
      after.cell.intentFragmentHash,
    ],
    ["agent", before.cell.agent, after.cell.agent],
    ["model", before.cell.model, after.cell.model],
    [
      "reasoningEffort",
      before.cell.reasoningEffort,
      after.cell.reasoningEffort,
    ],
  ].find(([, beforeValue, afterValue]) => !equalValue(beforeValue, afterValue));
  if (cellIdentity) {
    return { compatibility: "incompatible", reason: cellIdentity[0] as string };
  }
  const identityMismatch = recordDimensionMismatch(
    before.record,
    after.record,
    scenario,
  );
  return identityMismatch
    ? { compatibility: "incompatible", reason: identityMismatch }
    : { compatibility: "compatible", reason: null };
}

function buildComparisonCell(
  before: AgentEvalImportedSuite,
  after: AgentEvalImportedSuite,
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
  globalSuppressed: boolean,
): z.infer<typeof comparisonCellSchema> {
  const beforeSource = suiteCellSource(before, scenario, workloadId);
  const afterSource = suiteCellSource(after, scenario, workloadId);
  const workloadMismatch = workloadContentMismatch(before, after, workloadId);
  const compatibility = cellCompatibilityReason(
    beforeSource,
    afterSource,
    scenario,
    globalSuppressed,
    workloadMismatch,
  );
  const eligible =
    compatibleCellMetric(
      beforeSource,
      afterSource,
      globalSuppressed,
      workloadMismatch,
      scenario,
    ) && compatibility.compatibility === "compatible";
  const beforeRecord = beforeSource.record;
  const afterRecord = afterSource.record;
  return {
    id: suiteCellId(scenario, workloadId),
    scenario,
    workloadId,
    workloadPath: workloadPath(before, after, workloadId),
    profile:
      beforeSource.cell?.profile ??
      afterSource.cell?.profile ??
      scenarioDefinition(scenario).guidanceProfile,
    guidanceProfile:
      beforeSource.cell?.guidanceProfile ??
      afterSource.cell?.guidanceProfile ??
      scenarioDefinition(scenario).guidanceProfile,
    intentProfile:
      beforeSource.cell?.intentProfile ??
      afterSource.cell?.intentProfile ??
      scenarioDefinition(scenario).intentProfile,
    intentFragmentHash:
      beforeSource.cell?.intentFragmentHash ??
      afterSource.cell?.intentFragmentHash ??
      scenarioDefinition(scenario).intentFragmentHash,
    agent: AGENT_EVAL_SUITE_MATRIX.agent,
    model: AGENT_EVAL_SUITE_MATRIX.model,
    reasoningEffort: AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
    beforeStatus: beforeSource.cell?.status ?? null,
    afterStatus: afterSource.cell?.status ?? null,
    compatibility: compatibility.compatibility,
    incompatibilityReason: compatibility.reason,
    durationMs: metricForCell(
      beforeRecord?.durationMs ?? null,
      afterRecord?.durationMs ?? null,
      eligible,
    ),
    logicalToolCalls: metricForCell(
      beforeRecord?.tools.logicalCallCount ?? null,
      afterRecord?.tools.logicalCallCount ?? null,
      eligible,
    ),
    tokens: {
      uncachedInputTokens: metricForCell(
        metricValue(beforeRecord, "uncachedInputTokens"),
        metricValue(afterRecord, "uncachedInputTokens"),
        eligible,
      ),
      cachedInputTokens: metricForCell(
        metricValue(beforeRecord, "cachedInputTokens"),
        metricValue(afterRecord, "cachedInputTokens"),
        eligible,
      ),
      cacheWriteInputTokens: metricForCell(
        metricValue(beforeRecord, "cacheWriteInputTokens"),
        metricValue(afterRecord, "cacheWriteInputTokens"),
        eligible,
      ),
      outputTokens: metricForCell(
        metricValue(beforeRecord, "outputTokens"),
        metricValue(afterRecord, "outputTokens"),
        eligible,
      ),
      reasoningOutputTokens: metricForCell(
        metricValue(beforeRecord, "reasoningOutputTokens"),
        metricValue(afterRecord, "reasoningOutputTokens"),
        eligible,
      ),
    },
    costUsd: metricForCell(
      costValue(beforeRecord),
      costValue(afterRecord),
      eligible,
    ),
    callsByTool: eligible
      ? callsComparison(
          callsByToolForRecord(beforeRecord),
          callsByToolForRecord(afterRecord),
        )
      : null,
    toolSequence: (() => {
      const sequence = sequenceComparison(
        sequenceForRecord(beforeRecord),
        sequenceForRecord(afterRecord),
      );
      return eligible ? sequence : { ...sequence, changed: null };
    })(),
    processStatus: statusComparison(
      beforeRecord?.processStatus ?? null,
      afterRecord?.processStatus ?? null,
    ),
    finalStatus: statusComparison(
      beforeRecord?.finalStatus ?? null,
      afterRecord?.finalStatus ?? null,
    ),
  };
}

function metricCells(
  cells: z.infer<typeof comparisonCellSchema>[],
  metric: (
    cell: z.infer<typeof comparisonCellSchema>,
  ) => z.infer<typeof comparisonMetricSchema> | null,
): Array<{
  id: string;
  eligible: boolean;
  before: number | null;
  after: number | null;
}> {
  return cells.map((cell) => {
    const value = metric(cell);
    return {
      id: cell.id,
      eligible: cell.compatibility === "compatible" && value !== null,
      before: value?.before ?? null,
      after: value?.after ?? null,
    };
  });
}

function callsMetricCells(
  cells: z.infer<typeof comparisonCellSchema>[],
): Array<{
  id: string;
  eligible: boolean;
  before: z.infer<typeof suiteCallsByToolSchema>[] | null;
  after: z.infer<typeof suiteCallsByToolSchema>[] | null;
}> {
  return cells.map((cell) => ({
    id: cell.id,
    eligible: cell.compatibility === "compatible" && cell.callsByTool !== null,
    before: cell.callsByTool?.before ?? null,
    after: cell.callsByTool?.after ?? null,
  }));
}

export interface AgentEvalSuiteComparisonBuildOptions {
  mode: "live-pair" | "offline";
  comparisonId: string;
  startedAt: string;
  completedAt: string;
  outputDir?: string | null;
  outputPath?: string | null;
}

/**
 * Builds a comparison from two independently loaded suite artifacts without
 * launching agents. It preserves full cell status evidence and applies
 * compatibility and matched-cohort rules before calculating direct deltas.
 */
export function buildSuiteComparison(
  baseline: AgentEvalImportedSuite,
  candidate: AgentEvalImportedSuite,
  options: AgentEvalSuiteComparisonBuildOptions,
): AgentEvalSuiteComparison {
  const dimensions = matrixDimensions(baseline.artifact, candidate.artifact);
  const globalIncompatibility = dimensions.some(
    (dimension) =>
      dimension.status === "incompatible" &&
      ((dimension.name.startsWith("matrix.") &&
        dimension.name !== "matrix.scenarios") ||
        dimension.name === "suiteName" ||
        dimension.name === "dryRun"),
  );
  const reportingMismatch = dimensions.some(
    (dimension) =>
      dimension.name === "reportingContract" &&
      dimension.status === "incompatible",
  );
  const resultSchemaMismatch = dimensions.some(
    (dimension) =>
      dimension.name === "resultSchema" && dimension.status === "incompatible",
  );
  const directDeltasSuppressed =
    globalIncompatibility || reportingMismatch || resultSchemaMismatch;
  const harnessGitMismatch = dimensions.some(
    (dimension) =>
      dimension.name === "measurementGit" && dimension.status !== "compatible",
  );
  const codexVersionMismatch = dimensions.some(
    (dimension) =>
      dimension.name === "codexVersion" && dimension.status !== "compatible",
  );
  const workloadMismatches = new Set<string>();
  for (const workload of [
    ...baseline.artifact.selectedWorkloads,
    ...candidate.artifact.selectedWorkloads,
  ]) {
    if (workloadContentMismatch(baseline, candidate, workload.id)) {
      workloadMismatches.add(workload.id);
    }
  }
  const cells = allCellKeys(baseline, candidate).map(
    ({ scenario, workloadId }) =>
      buildComparisonCell(
        baseline,
        candidate,
        scenario,
        workloadId,
        directDeltasSuppressed,
      ),
  );
  const allCellIds = cells.map((cell) => cell.id);
  const aggregateMetricCells = (
    metric: (
      cell: z.infer<typeof comparisonCellSchema>,
    ) => z.infer<typeof comparisonMetricSchema> | null,
  ) => metricCells(cells, metric);
  const aggregates = {
    durationMs: aggregateMetric(
      aggregateMetricCells((cell) => cell.durationMs),
    ),
    logicalToolCalls: aggregateMetric(
      aggregateMetricCells((cell) => cell.logicalToolCalls),
    ),
    tokens: {
      uncachedInputTokens: aggregateMetric(
        aggregateMetricCells((cell) => cell.tokens.uncachedInputTokens),
      ),
      cachedInputTokens: aggregateMetric(
        aggregateMetricCells((cell) => cell.tokens.cachedInputTokens),
      ),
      cacheWriteInputTokens: aggregateMetric(
        aggregateMetricCells((cell) => cell.tokens.cacheWriteInputTokens),
      ),
      outputTokens: aggregateMetric(
        aggregateMetricCells((cell) => cell.tokens.outputTokens),
      ),
      reasoningOutputTokens: aggregateMetric(
        aggregateMetricCells((cell) => cell.tokens.reasoningOutputTokens),
      ),
    },
    costUsd: aggregateMetric(aggregateMetricCells((cell) => cell.costUsd)),
    callsByTool: aggregateToolCalls(callsMetricCells(cells)),
  };
  if (directDeltasSuppressed) {
    const excluded = [...allCellIds].sort(compareStrings);
    const suppress = (): z.infer<typeof comparisonAggregateMetricSchema> => ({
      before: null,
      after: null,
      delta: null,
      percentChange: null,
      change: "unknown",
      includedCellIds: [],
      excludedCellIds: excluded,
    });
    aggregates.durationMs = suppress();
    aggregates.logicalToolCalls = suppress();
    aggregates.tokens.uncachedInputTokens = suppress();
    aggregates.tokens.cachedInputTokens = suppress();
    aggregates.tokens.cacheWriteInputTokens = suppress();
    aggregates.tokens.outputTokens = suppress();
    aggregates.tokens.reasoningOutputTokens = suppress();
    aggregates.costUsd = suppress();
    aggregates.callsByTool = {
      before: null,
      after: null,
      deltas: null,
      includedCellIds: [],
      excludedCellIds: excluded,
    };
  }
  const warnings = comparisonWarnings(dimensions, [...workloadMismatches]);
  const attributionWarnings = [
    ...gitAttributionWarnings(
      "baseline",
      "measurementGit",
      baseline.artifact.measurementGit,
    ),
    ...gitAttributionWarnings(
      "candidate",
      "measurementGit",
      candidate.artifact.measurementGit,
    ),
    ...gitAttributionWarnings(
      "baseline",
      "targetGit",
      baseline.artifact.targetGit,
    ),
    ...gitAttributionWarnings(
      "candidate",
      "targetGit",
      candidate.artifact.targetGit,
    ),
  ];
  warnings.push(...attributionWarnings);
  if (directDeltasSuppressed) {
    warnings.push(
      "direct metric deltas suppressed by incompatible suite identity",
    );
  }
  const repositoryOnly =
    !harnessGitMismatch &&
    !codexVersionMismatch &&
    !directDeltasSuppressed &&
    workloadMismatches.size === 0 &&
    attributionWarnings.length === 0;
  if (!repositoryOnly) {
    warnings.push(
      "comparison is not repository-only; harness, content, or target attribution differs",
    );
  }
  return parseComparisonArtifact({
    schemaVersion: 2,
    comparisonId: options.comparisonId,
    mode: options.mode,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    outputDir: options.outputDir ?? null,
    outputPath: options.outputPath ?? null,
    baselineSuite: {
      suiteId: baseline.artifact.suiteId,
      suiteName: baseline.artifact.suiteName,
      path: baseline.suitePath,
      sha256: baseline.sha256,
    },
    candidateSuite: {
      suiteId: candidate.artifact.suiteId,
      suiteName: candidate.artifact.suiteName,
      path: candidate.suitePath,
      sha256: candidate.sha256,
    },
    compatibility: {
      compatible:
        !globalIncompatibility && !reportingMismatch && !resultSchemaMismatch,
      directDeltasSuppressed,
      repositoryOnly,
      dimensions,
    },
    repositoryOnly,
    cells,
    aggregates,
    warnings: [...new Set(warnings)].sort(compareStrings),
  });
}

export const compareSuiteArtifacts = buildSuiteComparison;

function comparisonOutputTimestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

export interface AgentEvalSuiteComparisonWriteOptions {
  outputDir: string;
}

export function writeComparisonArtifact(
  artifact: AgentEvalSuiteComparison,
  options: AgentEvalSuiteComparisonWriteOptions,
): AgentEvalSuiteComparison {
  const outputDir = resolve(options.outputDir);
  const outputPath = join(outputDir, "comparison.json");
  const validated = parseComparisonArtifact({
    ...artifact,
    outputDir,
    outputPath,
  });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(validated, null, 2)}\n`);
  return validated;
}

export interface AgentEvalSuiteOfflineCompareOptions {
  baselineSuitePath: string;
  candidateSuitePath: string;
  repoRoot?: string;
  outputDir?: string;
}

function compareImportedSuites(
  baselineSuitePath: string,
  candidateSuitePath: string,
  mode: "live-pair" | "offline",
  outputDir: string,
): AgentEvalSuiteComparison {
  const baseline = loadImportedSuite(baselineSuitePath);
  const candidate = loadImportedSuite(candidateSuitePath);
  const startedAt = new Date().toISOString();
  const outputPath = join(outputDir, "comparison.json");
  const artifact = buildSuiteComparison(baseline, candidate, {
    mode,
    comparisonId: randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    outputDir: resolve(outputDir),
    outputPath: resolve(outputPath),
  });
  return writeComparisonArtifact(artifact, { outputDir });
}

/**
 * Loads two existing suite artifacts and writes an offline comparison. No
 * agent or target executor runs; output defaults to the harness
 * `.agent-eval/comparisons/<timestamp>` directory unless overridden.
 */
export function compareAgentEvalSuitesOffline(
  options: AgentEvalSuiteOfflineCompareOptions,
): AgentEvalSuiteComparison {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const outputDir = resolve(
    repoRoot,
    options.outputDir ??
      join(".agent-eval", "comparisons", comparisonOutputTimestamp()),
  );
  return compareImportedSuites(
    options.baselineSuitePath,
    options.candidateSuitePath,
    "offline",
    outputDir,
  );
}

export const compareSuiteArtifactsOffline = compareAgentEvalSuitesOffline;

export interface AgentEvalSuitePairOptions {
  suite: AgentEvalSuiteName;
  repoRoot: string;
  baselineRoot: string;
  outDir?: string;
  manifestPath?: string;
  workloadsDir?: string;
  reportingPath?: string;
  schemaPath?: string;
  dryRun?: boolean;
  scenarios?: readonly AgentEvalSuiteScenario[];
  shardExecutor?: AgentEvalSuiteShardExecutor;
}

export interface AgentEvalSuitePairResult {
  baselineSuite: AgentEvalSuiteArtifact;
  candidateSuite: AgentEvalSuiteArtifact;
  comparison: AgentEvalSuiteComparison;
  outDir: string;
  baselineSuitePath: string;
  candidateSuitePath: string;
  comparisonPath: string;
}

/**
 * Runs a baseline target suite followed by the candidate suite rooted at the
 * measurement harness, then writes both suite artifacts and their comparison.
 * `repoRoot` owns shared harness inputs and output; `baselineRoot` is the only
 * alternate target. Dry runs and injected executors avoid paid agent work,
 * while production execution may invoke the configured agent.
 */
export async function runAgentEvalSuitePair(
  options: AgentEvalSuitePairOptions,
): Promise<AgentEvalSuitePairResult> {
  assert(options.baselineRoot.length > 0, "baselineRoot is required");
  const repoRoot = resolve(options.repoRoot);
  const outDir = resolve(
    repoRoot,
    options.outDir ?? join(".agent-eval", "pairs", comparisonOutputTimestamp()),
  );
  const shared = {
    suite: options.suite,
    manifestPath: options.manifestPath,
    workloadsDir: options.workloadsDir,
    reportingPath: options.reportingPath,
    schemaPath: options.schemaPath,
    dryRun: options.dryRun,
    scenarios: options.scenarios,
    shardExecutor: options.shardExecutor,
  };
  const baselineRoot = resolve(repoRoot, options.baselineRoot);
  const baselineRunOptions: AgentEvalSuiteRunOptions = {
    ...shared,
    repoRoot,
    targetRoot: baselineRoot,
    outDir: join(outDir, "baseline"),
  };
  const candidateRunOptions: AgentEvalSuiteRunOptions = {
    ...shared,
    repoRoot,
    targetRoot: repoRoot,
    outDir: join(outDir, "candidate"),
  };
  await Promise.all([
    suitePreflight(baselineRunOptions),
    suitePreflight(candidateRunOptions),
  ]);
  const baselineSuite = await runAgentEvalSuite(baselineRunOptions);
  const candidateSuite = await runAgentEvalSuite(candidateRunOptions);
  const comparisonDir = join(outDir, "comparison");
  const comparison = compareImportedSuites(
    join(outDir, "baseline", "suite.json"),
    join(outDir, "candidate", "suite.json"),
    "live-pair",
    comparisonDir,
  );
  return {
    baselineSuite,
    candidateSuite,
    comparison,
    outDir,
    baselineSuitePath: join(outDir, "baseline", "suite.json"),
    candidateSuitePath: join(outDir, "candidate", "suite.json"),
    comparisonPath: join(comparisonDir, "comparison.json"),
  };
}

export const runAgentEvalPair = runAgentEvalSuitePair;

export function parseComparisonArtifact(
  value: unknown,
): AgentEvalSuiteComparison {
  const parsed = agentEvalSuiteComparisonSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid comparison artifact: ${formatZodIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function loadComparisonArtifact(path: string): AgentEvalSuiteComparison {
  try {
    return parseComparisonArtifact(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid comparison artifact")
    ) {
      throw error;
    }
    throw new Error(
      `Comparison artifact is not valid JSON: ${errorMessage(error)}`,
    );
  }
}

function formatComparisonValue(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "unknown";
}

function formatCellIds(ids: string[]): string {
  return ids.length > 0 ? `${ids.length} [${ids.join(", ")}]` : "0";
}

function formatComparisonMetric(
  metric: z.infer<typeof comparisonMetricSchema> | null,
): string {
  if (metric === null) return "unknown";
  return `before=${formatComparisonValue(metric.before)} after=${formatComparisonValue(metric.after)} delta=${formatComparisonValue(metric.delta)} change=${metric.change} percent=${formatComparisonValue(metric.percentChange)}`;
}

function formatAggregateMetric(
  name: string,
  metric: z.infer<typeof comparisonAggregateMetricSchema>,
): string {
  return `${name}: ${formatComparisonMetric(metric)} included=${formatCellIds(metric.includedCellIds)} excluded=${formatCellIds(metric.excludedCellIds)}`;
}

function formatToolCounts(
  entry: z.infer<typeof suiteCallsByToolSchema> | null,
): string {
  if (entry === null) return "unknown";
  return `total=${entry.total} started=${entry.started} completed=${entry.completed} failed=${entry.failed} unknown=${entry.unknown}`;
}

function formatToolEntries(
  entries: z.infer<typeof suiteCallsByToolSchema>[] | null,
): string {
  if (entries === null) return "unknown";
  if (entries.length === 0) return "none";
  return entries
    .map((entry) => `${entry.surface}/${entry.tool} ${formatToolCounts(entry)}`)
    .join("; ");
}

function formatComparisonSequence(sequence: string[] | null): string {
  if (sequence === null) return "unknown";
  return sequence.length > 0 ? sequence.join(" -> ") : "none";
}

function formatCellCallsByTool(
  calls: z.infer<typeof comparisonCallsByToolSchema> | null,
): string[] {
  if (calls === null) return ["callsByTool: unknown"];
  const lines = [
    `callsByTool: before=${formatToolEntries(calls.before)} after=${formatToolEntries(calls.after)}`,
  ];
  if (calls.deltas === null) {
    lines.push("  tool deltas: unknown");
  } else {
    for (const tool of calls.deltas) {
      lines.push(
        `  tool ${tool.surface}/${tool.tool}: before=${formatToolCounts(tool.before)} after=${formatToolCounts(tool.after)} delta=${tool.delta === null ? "unknown" : `total=${tool.delta.total} started=${tool.delta.started} completed=${tool.delta.completed} failed=${tool.delta.failed} unknown=${tool.delta.unknown}`} change=${tool.change} percent=${formatComparisonValue(tool.percentChange)}`,
      );
    }
  }
  return lines;
}

/**
 * Formats comparison identity, compatibility, aggregate, and per-cell evidence
 * without recomputing comparison data. Unknown and excluded metrics remain
 * visibly unknown in the human-readable output.
 */
export function formatComparisonReport(
  artifact: AgentEvalSuiteComparison,
): string {
  const lines = [
    `Agent eval comparison: ${artifact.mode} repositoryOnly=${artifact.repositoryOnly}`,
    `baseline=${artifact.baselineSuite.suiteName}/${artifact.baselineSuite.suiteId} path=${artifact.baselineSuite.path} sha256=${artifact.baselineSuite.sha256}`,
    `candidate=${artifact.candidateSuite.suiteName}/${artifact.candidateSuite.suiteId} path=${artifact.candidateSuite.path} sha256=${artifact.candidateSuite.sha256}`,
    `compatibility=${artifact.compatibility.compatible ? "compatible" : "incompatible"} suppressed=${artifact.compatibility.directDeltasSuppressed} dimensions=${artifact.compatibility.dimensions.length}`,
    "dimensions:",
  ];
  for (const dimension of artifact.compatibility.dimensions) {
    lines.push(
      `  ${dimension.name}: ${dimension.status} before=${formatComparisonValue(dimension.before)} after=${formatComparisonValue(dimension.after)}${dimension.reason ? ` reason=${dimension.reason}` : ""}`,
    );
  }
  lines.push("aggregates:");
  lines.push(
    formatAggregateMetric("durationMs", artifact.aggregates.durationMs),
  );
  lines.push(
    formatAggregateMetric(
      "logicalToolCalls",
      artifact.aggregates.logicalToolCalls,
    ),
  );
  for (const [name, metric] of Object.entries(artifact.aggregates.tokens)) {
    lines.push(formatAggregateMetric(`tokens.${name}`, metric));
  }
  lines.push(formatAggregateMetric("costUsd", artifact.aggregates.costUsd));
  const aggregateCalls = artifact.aggregates.callsByTool;
  lines.push(
    `callsByTool: before=${formatToolEntries(aggregateCalls.before)} after=${formatToolEntries(aggregateCalls.after)} included=${formatCellIds(aggregateCalls.includedCellIds)} excluded=${formatCellIds(aggregateCalls.excludedCellIds)}`,
  );
  if (aggregateCalls.deltas === null) {
    lines.push("  tool deltas: unknown");
  } else {
    for (const tool of aggregateCalls.deltas) {
      lines.push(
        `  tool ${tool.surface}/${tool.tool}: before=${formatToolCounts(tool.before)} after=${formatToolCounts(tool.after)} delta=${tool.delta === null ? "unknown" : `total=${tool.delta.total} started=${tool.delta.started} completed=${tool.delta.completed} failed=${tool.delta.failed} unknown=${tool.delta.unknown}`} change=${tool.change} percent=${formatComparisonValue(tool.percentChange)}`,
      );
    }
  }
  lines.push(`cells: ${artifact.cells.length}`);
  for (const cell of artifact.cells) {
    lines.push(
      `cell ${cell.id}: scenario=${cell.scenario} guidance=${cell.guidanceProfile} intent=${cell.intentProfile} before=${cell.beforeStatus ?? "missing"} after=${cell.afterStatus ?? "missing"} compatibility=${cell.compatibility}${cell.incompatibilityReason ? ` reason=${cell.incompatibilityReason}` : ""}`,
    );
    lines.push(`  durationMs: ${formatComparisonMetric(cell.durationMs)}`);
    lines.push(
      `  logicalToolCalls: ${formatComparisonMetric(cell.logicalToolCalls)}`,
    );
    for (const [name, metric] of Object.entries(cell.tokens)) {
      lines.push(`  tokens.${name}: ${formatComparisonMetric(metric)}`);
    }
    lines.push(`  costUsd: ${formatComparisonMetric(cell.costUsd)}`);
    lines.push(...formatCellCallsByTool(cell.callsByTool));
    lines.push(
      `  sequence: before=${formatComparisonSequence(cell.toolSequence.before)} after=${formatComparisonSequence(cell.toolSequence.after)} changed=${formatComparisonValue(cell.toolSequence.changed)}`,
    );
    lines.push(
      `  processStatus: before=${formatComparisonValue(cell.processStatus.before)} after=${formatComparisonValue(cell.processStatus.after)} changed=${formatComparisonValue(cell.processStatus.changed)}`,
    );
    lines.push(
      `  finalStatus: before=${formatComparisonValue(cell.finalStatus.before)} after=${formatComparisonValue(cell.finalStatus.after)} changed=${formatComparisonValue(cell.finalStatus.changed)}`,
    );
  }
  for (const warning of artifact.warnings) lines.push(`Warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

const AGENT_EVAL_SUITE_CLI_MODES = ["run", "pair", "compare"] as const;
type AgentEvalSuiteCliMode = (typeof AGENT_EVAL_SUITE_CLI_MODES)[number];

export type AgentEvalSuiteCliCommand =
  | { mode: "help" }
  | {
      mode: "run";
      suite: AgentEvalSuiteName;
      scenarios?: AgentEvalSuiteScenario[];
      outDir?: string;
      targetRoot?: string;
      dryRun: boolean;
    }
  | {
      mode: "pair";
      suite: AgentEvalSuiteName;
      scenarios?: AgentEvalSuiteScenario[];
      baselineRoot: string;
      outDir?: string;
      dryRun: boolean;
    }
  | {
      mode: "compare";
      baselineSuitePath: string;
      candidateSuitePath: string;
      outDir?: string;
    };

export const AGENT_EVAL_SUITE_USAGE = `Usage:
  bun run agent:e2e:suite run --suite <name> [--scenario <discovery|intent|full>]... [--dry-run] [--out <dir>] [--target-root <path>]
  bun run agent:e2e:suite pair --suite <name> --baseline-root <path> [--scenario <discovery|intent|full>]... [--dry-run] [--out <dir>]
  bun run agent:e2e:suite compare --baseline-suite <path> --candidate-suite <path> [--out <dir>]

Suites: ${AGENT_EVAL_SUITE_NAMES.join(", ")}
Matrix: Codex ${LUNA_MODEL}, reasoning low, local MCP
Defaults: canary discovery + intent; other suites intent only. Explicit --scenario values replace defaults; full is opt-in.
`;

const CLI_OPTIONS_BY_MODE: Record<AgentEvalSuiteCliMode, readonly string[]> = {
  run: ["--suite", "--scenario", "--out", "--target-root", "--dry-run"],
  pair: ["--suite", "--baseline-root", "--scenario", "--out", "--dry-run"],
  compare: ["--baseline-suite", "--candidate-suite", "--out"],
};

function isCliMode(value: string): value is AgentEvalSuiteCliMode {
  return (AGENT_EVAL_SUITE_CLI_MODES as readonly string[]).includes(value);
}

function assertCliValue(value: string | undefined, flag: string): string {
  assert(value !== undefined && value.length > 0, `${flag} requires a value`);
  return value;
}

function assertSuiteName(value: string): AgentEvalSuiteName {
  assert(
    AGENT_EVAL_SUITE_NAMES.includes(value as AgentEvalSuiteName),
    `unknown suite name: ${value}`,
  );
  return value as AgentEvalSuiteName;
}

export function parseAgentEvalSuiteCliArgs(
  args: readonly string[],
): AgentEvalSuiteCliCommand {
  if (args.length === 0) {
    return { mode: "help" };
  }
  if (args.includes("--help")) {
    assert(
      args.filter((arg) => arg === "--help").length === 1,
      "duplicate argument: --help",
    );
    const withoutHelp = args.filter((arg) => arg !== "--help");
    assert(
      withoutHelp.length === 0 ||
        (withoutHelp.length === 1 && isCliMode(withoutHelp[0] ?? "")),
      "--help must be used alone or with one command",
    );
    return { mode: "help" };
  }
  const [rawMode, ...tokens] = args;
  assert(
    rawMode !== undefined && isCliMode(rawMode),
    `unknown mode: ${rawMode}`,
  );
  const values = new Map<string, string | true>();
  const scenarios: AgentEvalSuiteScenario[] = [];
  const allowed = new Set(CLI_OPTIONS_BY_MODE[rawMode]);
  for (let index = 0; index < tokens.length; index += 1) {
    const flag = tokens[index];
    assert(flag !== undefined, `unexpected argument: ${flag}`);
    assert(flag.startsWith("--"), `unexpected argument: ${flag}`);
    assert(allowed.has(flag), `${flag} is not valid for ${rawMode}`);
    if (flag === "--scenario") {
      const value = tokens[index + 1];
      assert(
        value !== undefined && !value.startsWith("--"),
        `${flag} requires a value`,
      );
      assert(
        AGENT_EVAL_SUITE_SCENARIOS.includes(value as AgentEvalSuiteScenario),
        `unknown suite scenario: ${value}`,
      );
      assert(
        !scenarios.includes(value as AgentEvalSuiteScenario),
        `duplicate argument: ${flag} ${value}`,
      );
      scenarios.push(value as AgentEvalSuiteScenario);
      index += 1;
      continue;
    }
    assert(!values.has(flag), `duplicate argument: ${flag}`);
    if (flag === "--dry-run") {
      values.set(flag, true);
      continue;
    }
    const value = tokens[index + 1];
    assert(
      value !== undefined && !value.startsWith("--"),
      `${flag} requires a value`,
    );
    values.set(flag, assertCliValue(value, flag));
    index += 1;
  }
  const getValue = (flag: string): string | undefined => {
    const value = values.get(flag);
    return typeof value === "string" ? value : undefined;
  };
  const dryRun = values.has("--dry-run");
  if (rawMode === "run") {
    return {
      mode: rawMode,
      suite: assertSuiteName(assertCliValue(getValue("--suite"), "--suite")),
      scenarios: scenarios.length > 0 ? scenarios : undefined,
      outDir: getValue("--out"),
      targetRoot: getValue("--target-root"),
      dryRun,
    };
  }
  if (rawMode === "pair") {
    return {
      mode: rawMode,
      suite: assertSuiteName(assertCliValue(getValue("--suite"), "--suite")),
      scenarios: scenarios.length > 0 ? scenarios : undefined,
      baselineRoot: assertCliValue(
        getValue("--baseline-root"),
        "--baseline-root",
      ),
      outDir: getValue("--out"),
      dryRun,
    };
  }
  assert(!dryRun, "--dry-run is not valid for compare");
  return {
    mode: rawMode,
    baselineSuitePath: assertCliValue(
      getValue("--baseline-suite"),
      "--baseline-suite",
    ),
    candidateSuitePath: assertCliValue(
      getValue("--candidate-suite"),
      "--candidate-suite",
    ),
    outDir: getValue("--out"),
  };
}

function defaultSuiteOutputDir(repoRoot: string): string {
  return resolve(
    repoRoot,
    ".agent-eval",
    "suites",
    comparisonOutputTimestamp(),
  );
}

export interface AgentEvalSuiteCliDependencies {
  runSuite?: typeof runAgentEvalSuite;
  runPair?: typeof runAgentEvalSuitePair;
  compareOffline?: typeof compareAgentEvalSuitesOffline;
}

export async function runAgentEvalSuiteCli(
  args: readonly string[],
  repoRoot = process.cwd(),
  dependencies: AgentEvalSuiteCliDependencies = {},
): Promise<string> {
  const command = parseAgentEvalSuiteCliArgs(args);
  if (command.mode === "help") return AGENT_EVAL_SUITE_USAGE;
  const root = resolve(repoRoot);
  if (command.mode === "run") {
    const outDir = resolve(root, command.outDir ?? defaultSuiteOutputDir(root));
    const artifact = await (dependencies.runSuite ?? runAgentEvalSuite)({
      suite: command.suite,
      repoRoot: root,
      targetRoot: command.targetRoot,
      outDir,
      dryRun: command.dryRun,
      scenarios: command.scenarios,
    });
    return `${formatSuiteReport(artifact)}suite artifact: ${join(outDir, "suite.json")}\n`;
  }
  if (command.mode === "pair") {
    const outDir = command.outDir ? resolve(root, command.outDir) : undefined;
    const result = await (dependencies.runPair ?? runAgentEvalSuitePair)({
      suite: command.suite,
      repoRoot: root,
      baselineRoot: command.baselineRoot,
      outDir,
      dryRun: command.dryRun,
      scenarios: command.scenarios,
    });
    return `${formatSuiteReport(result.baselineSuite)}${formatSuiteReport(result.candidateSuite)}${formatComparisonReport(result.comparison)}artifacts:\n  baseline suite: ${result.baselineSuitePath}\n  candidate suite: ${result.candidateSuitePath}\n  comparison: ${result.comparisonPath}\n`;
  }
  const result = await (
    dependencies.compareOffline ?? compareAgentEvalSuitesOffline
  )({
    baselineSuitePath: command.baselineSuitePath,
    candidateSuitePath: command.candidateSuitePath,
    repoRoot: root,
    outputDir: command.outDir ? resolve(root, command.outDir) : undefined,
  });
  return `${formatComparisonReport(result)}comparison artifact: ${result.outputPath ?? "unknown"}\n`;
}

async function main(): Promise<void> {
  process.stdout.write(
    await runAgentEvalSuiteCli(process.argv.slice(2), process.cwd()),
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
