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
import { extname, join, relative, resolve } from "node:path";
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
  agentEvalMetricsSchema,
  LUNA_MODEL,
} from "./agent-eval-metrics.ts";
import { type AgentEvalReport, loadRunReport } from "./agent-eval-report.ts";

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

export const AGENT_EVAL_SUITE_MATRIX = {
  agent: "codex",
  model: LUNA_MODEL,
  reasoningEffort: "low",
  surface: "mcp",
  server: "local",
  profiles: AGENT_EVAL_SUITE_PROFILES,
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
  shardExecutor?: AgentEvalSuiteShardExecutor;
}

export interface AgentEvalSuiteShardOptions {
  suite: AgentEvalSuiteName;
  profile: AgentEvalSuiteProfile;
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
  status?: "success" | "failed";
  error?: string;
}

export type AgentEvalSuiteShardExecutor = (
  options: AgentEvalSuiteShardOptions,
) => Promise<AgentEvalSuiteShardExecution | undefined>;

const suiteProfileSchema = z.enum(AGENT_EVAL_SUITE_PROFILES);
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
  profile: suiteProfileSchema,
  status: z.enum(["success", "failed"]),
  error: z.string().nullable(),
  runPath: z.string().nullable(),
  metricsPath: z.string().nullable(),
  reportPath: z.string().nullable(),
});
const descriptorShardSchema = suiteShardSchema.extend({
  profile: z.literal("descriptors"),
});
const fullShardSchema = suiteShardSchema.extend({
  profile: z.literal("full"),
});
const suiteCellSchema = z.object({
  id: z.string().min(1),
  profile: suiteProfileSchema,
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
  shards: z.tuple([descriptorShardSchema, fullShardSchema]),
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

export function parseSuiteArtifact(value: unknown): AgentEvalSuiteArtifact {
  const parsed = agentEvalSuiteArtifactSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid suite artifact: ${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
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
  profile: AgentEvalSuiteProfile,
  workloadId: string,
): string {
  return `${profile}/${workloadId}`;
}

type SuiteCellStatus = "success" | "failed" | "missing" | "unknown";
interface SuiteCell {
  id: string;
  profile: AgentEvalSuiteProfile;
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
  profile: AgentEvalSuiteProfile,
  execution: AgentEvalSuiteShardExecution | undefined,
  error: string | null,
): ShardEvidence {
  const defaultRunDir = join(suiteRoot, "shards", profile);
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
      throw new Error(`Missing child run.json for ${profile}`);
    const runValue = JSON.parse(readFileSync(runPath, "utf8")) as Record<
      string,
      unknown
    >;
    const metrics = resolvedMetricsPath
      ? agentEvalMetricsSchema.parse(
          JSON.parse(readFileSync(metricsPath, "utf8")),
        )
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
  profiles: readonly AgentEvalSuiteProfile[],
  workloads: AgentEvalSuiteWorkload[],
  evidence: Map<AgentEvalSuiteProfile, ShardEvidence>,
): SuiteCell[] {
  return profiles.flatMap((profile) => {
    const shard = evidence.get(profile);
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
        id: suiteCellId(profile, workload.id),
        profile,
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
    .filter(
      (cell) =>
        cell.record === undefined ||
        cell.record.tools.logicalCallCount === null,
    )
    .map((cell) => cell.id);
  if (missingCellIds.length > 0) {
    return { callsByTool: null, missingCellIds };
  }
  const entries = new Map<string, z.infer<typeof suiteCallsByToolSchema>>();
  for (const cell of cells) {
    for (const call of cell.record?.tools.sequence ?? []) {
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
      entry.total += 1;
      entry[call.status] += 1;
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
  evidence: Map<AgentEvalSuiteProfile, ShardEvidence>,
  shardExecutions: Map<
    AgentEvalSuiteProfile,
    AgentEvalSuiteShardExecution | undefined
  >,
  wallTimeMs: number,
): AgentEvalSuiteArtifact {
  const cells = buildSuiteCells(
    AGENT_EVAL_SUITE_PROFILES,
    preflight.workloads,
    evidence,
  );
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
  for (const [profile, shard] of evidence) {
    if (shard.status === "failed" && shard.error) {
      warnings.add(`${profile} shard failed: ${shard.error}`);
    }
    for (const warning of shard.metrics?.warnings ?? []) {
      warnings.add(`${profile} metrics warning: ${warning}`);
    }
    for (const warning of shard.report?.warnings ?? []) {
      warnings.add(`${profile} report warning: ${warning}`);
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
  const shards = AGENT_EVAL_SUITE_PROFILES.map((profile) => {
    const shard = evidence.get(profile);
    const execution = shardExecutions.get(profile);
    return {
      profile,
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
    schemaVersion: 1,
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
      profiles: [...AGENT_EVAL_SUITE_PROFILES] as [
        AgentEvalSuiteProfile,
        AgentEvalSuiteProfile,
      ],
    },
    selectedWorkloads: preflight.workloads,
    contentIdentity: preflight.contentIdentity,
    targetGuidanceIdentity: preflight.targetGuidanceIdentity,
    shards,
    cells: cells.map(
      ({ id, profile, workloadId, workloadPath, status, durationMs }) => ({
        id,
        profile,
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
    workloads: workloadPaths.map((path) => fileIdentity(repoRoot, path)),
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
    options.profile,
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

export async function runAgentEvalSuite(
  options: AgentEvalSuiteRunOptions,
): Promise<AgentEvalSuiteArtifact> {
  const preflight = await suitePreflight(options);
  mkdirSync(preflight.outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const executor = options.shardExecutor ?? productionShardExecutor;
  const shardOptions = AGENT_EVAL_SUITE_PROFILES.map((profile) => ({
    suite: preflight.suite,
    profile,
    repoRoot: preflight.repoRoot,
    targetRoot: preflight.targetRoot,
    outDir: join(preflight.outDir, "shards", profile),
    reportingPath: preflight.reportingPath,
    schemaPath: preflight.schemaPath,
    dryRun: preflight.dryRun,
    experimentalTools: preflight.suite === "experimental",
    workloads: preflight.workloads,
    workloadPaths: preflight.workloadPaths,
    matrix: AGENT_EVAL_SUITE_MATRIX,
  }));
  const promises = shardOptions.map((shard) =>
    Promise.resolve()
      .then(() => executor(shard))
      .then(
        (execution) =>
          execution ?? { runDir: shard.outDir, status: "success" as const },
        (error): AgentEvalSuiteShardExecution => ({
          status: "failed",
          error: errorMessage(error),
        }),
      ),
  );
  const executions = await Promise.all(promises);
  const evidence = new Map<AgentEvalSuiteProfile, ShardEvidence>();
  const executionMap = new Map<
    AgentEvalSuiteProfile,
    AgentEvalSuiteShardExecution | undefined
  >();
  for (let index = 0; index < AGENT_EVAL_SUITE_PROFILES.length; index += 1) {
    const profile = AGENT_EVAL_SUITE_PROFILES[index];
    assert(profile, "missing suite profile");
    const execution = executions[index];
    executionMap.set(profile, execution);
    evidence.set(
      profile,
      readShardEvidence(
        preflight.outDir,
        profile,
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
    `matrix=${artifact.matrix.agent}:${artifact.matrix.model}/${artifact.matrix.reasoningEffort} profiles=${artifact.matrix.profiles.join(",")} workloads=${artifact.selectedWorkloads.length}`,
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
      `shard ${shard.profile} ${shard.status}${shard.error ? ` error=${shard.error}` : ""} run=${shard.runPath ?? "missing"} metrics=${shard.metricsPath ?? "missing"} report=${shard.reportPath ?? "missing"}`,
    );
  }
  for (const warning of artifact.warnings) lines.push(`Warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}
