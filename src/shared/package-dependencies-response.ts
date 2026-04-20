/**
 * Hand-crafted response envelope for the `package_dependencies` tool.
 * Shared by CLI `--json` output and MCP `content[0].text`. The terminal
 * formatter is CLI-only.
 *
 * Key design commitments (locked in the plan):
 *
 * - **Data-first envelope.** Whenever the backend returned
 *   `dependencies.direct`, we emit a `runtime` block with the flat
 *   list and a client-computed count. Whenever the backend returned
 *   `dependencyGroups`, we emit a `groups` block with every returned
 *   group verbatim. Agents don't branch on flags; they branch on
 *   what's in the envelope. Lifecycle filtering is server-side and
 *   visible via the optional `filter` metadata block.
 * - **Null vs empty matters.** `dependencyGroups: null` → omit
 *   `groups` entirely ("backend has no groups concept"). Non-null
 *   with zero members after filtering → `groups: { items: [] }`
 *   ("filter matched nothing"). Both map to different envelope
 *   shapes so agents can tell them apart.
 * - **No v-prefix normalisation.** Inherited from P2; tag-style
 *   inputs are rejected in the request builder before we get here.
 * - **Terminal-only dedup.** JSON preserves every tuple the backend
 *   sent (including Crates target-cfg duplicates). Terminal
 *   rendering strips duplicates inside each group for scannability.
 * - **`transitive.dag` is opaque passthrough.** Backend declares it
 *   `GenericJSON`; we neither parse nor render it. Agents that want
 *   structured DAG analysis read `transitive.dag` from JSON. Same
 *   rule applies to `conflicts`, `circularDependencies`, and
 *   `environmentConstraints`.
 */

import type {
  DependencyGroup,
  DependencyReport,
  UntypedGenericJSON,
} from "../services/index.js";
import { colorize, dim } from "./colors.js";
import type { DependencyLifecycle } from "./package-dependencies-request.js";
import { toPkgseerRegistryLowercase } from "./pkgseer-registry.js";

export interface LeanDirectDependency {
  name: string;
  /** Caller-declared range from the manifest (e.g. `^2.0.0`). */
  constraint?: string;
  /**
   * Concrete version the backend resolved for this dep. Surfaced when
   * the DAG was fetched alongside direct data (always for
   * `pkg deps`; on request for MCP agents). Absent when the backend
   * couldn't resolve or we didn't fetch the DAG.
   */
  version?: string;
}

export interface LeanRuntimeBlock {
  count: number;
  items: LeanDirectDependency[];
}

export interface LeanGroupDependency {
  name: string;
  constraint?: string;
}

export interface LeanGroup {
  name: string;
  lifecycle: string;
  conditionType: string;
  conditionValue?: string;
  selectionMode: string;
  exclusiveGroup?: string;
  fallbackPriority?: number;
  compatibleWith?: string[];
  defaultEnabled?: boolean;
  items: LeanGroupDependency[];
}

export interface LeanGroupsBlock {
  primaryGroup?: string;
  environmentConstraints?: UntypedGenericJSON[];
  items: LeanGroup[];
}

export interface LeanTransitiveImporter {
  name: string;
  /** Importer's own resolved version, when the DAG node carries one. */
  version?: string;
  /** Constraint the importer declared for this dep. */
  constraint?: string;
}

export interface LeanTransitivePackage {
  name: string;
  version?: string;
  /**
   * Importers for this package. Present when the DAG was decodable.
   * Empty when the package is the root (no incoming edges) or when
   * decoding failed for this node.
   */
  importers?: LeanTransitiveImporter[];
}

export interface LeanTypedConflict {
  name: string;
  requiredVersions: string[];
}

export interface LeanTypedCycle {
  cycle: string[];
}

export interface LeanTransitiveBlock {
  edges?: number;
  uniquePackages?: number;
  /**
   * Client-side echo of the caller's `maxDepth` input. Surfaces in the
   * summary line and the envelope so agents can tell which depth
   * produced the aggregate counts.
   */
  depth?: number;
  /**
   * Per-transitive-package records with resolved version + importer
   * provenance. Preprocessed from the backend's DAG so agents
   * consume the same signal the CLI `--verbose` view renders without
   * having to decode `GenericJSON` themselves.
   */
  packages?: LeanTransitivePackage[];
  /**
   * Typed when every entry decoded against the observed backend
   * shape (`{ package_name, required_versions }`). Raw passthrough
   * otherwise — agents can discriminate by checking for `name` /
   * `requiredVersions` fields.
   */
  conflicts?: LeanTypedConflict[] | UntypedGenericJSON[];
  /**
   * Typed when every entry decoded (observed: `{ cycle: string[] }`).
   * Raw passthrough otherwise.
   */
  circularDependencies?: LeanTypedCycle[] | UntypedGenericJSON[];
}

export interface LeanFilterBlock {
  lifecycles: DependencyLifecycle[];
}

export interface LeanDependencyReport {
  registry: string;
  name: string;
  version: string;
  requestedVersion?: string;
  runtime?: LeanRuntimeBlock;
  groups?: LeanGroupsBlock;
  transitive?: LeanTransitiveBlock;
  filter?: LeanFilterBlock;
}

export interface BuildDependenciesPayloadOptions {
  /** Raw caller-supplied version string (pre-normalisation). */
  requestedVersion?: string;
  /** Lifecycles that went on the wire. Empty → no filter. */
  canonicalLifecycles?: DependencyLifecycle[];
  /** Whether the caller asked for the transitive block. */
  includeTransitive?: boolean;
  /**
   * Caller-supplied maxDepth, echoed verbatim on the envelope for the
   * summary line. Omit when the caller asked for "no cap".
   */
  maxDepth?: number;
  /**
   * When true, populate `transitive.packages[].importers` with the
   * per-package provenance derived from the DAG. When false (the
   * default), packages are emitted with `{name, version}` only —
   * agents that just want the install footprint get a ~4× smaller
   * envelope. Use `true` when the caller wants the same data the
   * CLI `--verbose` view renders.
   */
  includeImporters?: boolean;
}

// --------------------------------------------------------------------
// Envelope builder
// --------------------------------------------------------------------

export function buildPackageDependenciesSuccessPayload(
  report: DependencyReport,
  options: BuildDependenciesPayloadOptions = {},
): LeanDependencyReport {
  const pkg = report.package;
  const payload: LeanDependencyReport = {
    registry: lowerRegistry(pkg.registry),
    name: pkg.name,
    version: pkg.version,
  };

  const requestedEcho = deriveRequestedVersion(
    options.requestedVersion,
    pkg.version,
  );
  if (requestedEcho !== undefined) {
    payload.requestedVersion = requestedEcho;
  }

  const bundle = report.dependencies;
  // Decode the DAG up front; used both for direct-dep version lookup
  // (always, when the DAG was fetched) and for verbose-mode importer
  // provenance later. Falls back to null on unknown shapes; each
  // consumer handles the absence gracefully.
  const decodedDagForResolution = decodeDag(bundle?.transitive?.dag);
  const directVersionByName = decodedDagForResolution
    ? buildDirectVersionLookup(decodedDagForResolution)
    : null;

  const directArray = bundle?.direct;
  if (directArray !== undefined) {
    const items = directArray.map((entry) =>
      buildDirect(entry, directVersionByName),
    );
    payload.runtime = { count: items.length, items };
  }

  const groupsInfo = report.dependencyGroups;
  if (groupsInfo !== undefined) {
    const groupItems = sortGroups(groupsInfo.groups.map(buildGroup));
    const groupsBlock: LeanGroupsBlock = { items: groupItems };
    if (groupsInfo.primaryGroup) {
      groupsBlock.primaryGroup = groupsInfo.primaryGroup;
    }
    if (
      groupsInfo.environmentConstraints &&
      groupsInfo.environmentConstraints.length > 0
    ) {
      groupsBlock.environmentConstraints =
        groupsInfo.environmentConstraints.slice();
    }
    payload.groups = groupsBlock;
  }

  if (options.includeTransitive) {
    const transitive = bundle?.transitive;
    if (transitive) {
      const block: LeanTransitiveBlock = {};
      if (transitive.totalEdges !== undefined) {
        block.edges = transitive.totalEdges;
      }
      if (transitive.uniquePackagesCount !== undefined) {
        block.uniquePackages = transitive.uniquePackagesCount;
      }
      if (options.maxDepth !== undefined) {
        block.depth = options.maxDepth;
      }
      const packages = buildTransitivePackages(
        transitive.uniqueDependencies,
        decodedDagForResolution,
        options.includeImporters ?? false,
      );
      if (packages && packages.length > 0) {
        block.packages = packages;
      }
      if (transitive.conflicts && transitive.conflicts.length > 0) {
        block.conflicts = buildTypedConflicts(transitive.conflicts);
      }
      if (
        transitive.circularDependencies &&
        transitive.circularDependencies.length > 0
      ) {
        block.circularDependencies = buildTypedCycles(
          transitive.circularDependencies,
        );
      }
      payload.transitive = block;
    }
  }

  if (options.canonicalLifecycles && options.canonicalLifecycles.length > 0) {
    payload.filter = { lifecycles: options.canonicalLifecycles.slice() };
  }

  return payload;
}

function buildDirect(
  entry: { name: string; versionConstraint?: string; type?: string },
  directVersionByName: Map<string, string> | null,
): LeanDirectDependency {
  const lean: LeanDirectDependency = { name: entry.name };
  if (entry.versionConstraint) lean.constraint = entry.versionConstraint;
  const resolved = directVersionByName?.get(entry.name);
  if (resolved) lean.version = resolved;
  return lean;
}

/**
 * Build a `name → resolved version` lookup for direct deps by scanning
 * the DAG's outgoing edges from the root node. Used during envelope
 * construction to annotate `runtime.items[].version` whenever the DAG
 * is available.
 */
function buildDirectVersionLookup(dag: DecodedDag): Map<string, string> | null {
  const rootIdx = findRootNodeIdx(dag);
  if (rootIdx === null) return null;
  const out = new Map<string, string>();
  for (const edge of dag.edges) {
    if (edge.fromIdx !== rootIdx) continue;
    const node = dag.nodes[edge.toIdx];
    if (!node || !node.version) continue;
    if (!out.has(node.name)) {
      out.set(node.name, node.version);
    }
  }
  return out.size > 0 ? out : null;
}

function findRootNodeIdx(dag: DecodedDag): number | null {
  const incoming = new Set<number>();
  for (const e of dag.edges) incoming.add(e.toIdx);
  let root: number | null = null;
  for (let i = 0; i < dag.nodes.length; i++) {
    if (!incoming.has(i)) {
      if (root !== null) return null; // ambiguous — multiple roots
      root = i;
    }
  }
  return root;
}

/**
 * Build the preprocessed `transitive.packages[]` array. Each entry
 * carries the name + resolved version (from the backend's
 * `uniqueDependencies` list) plus importer provenance when the DAG
 * decoded successfully. Agents consume this directly rather than
 * reverse-engineering the raw DAG — same source of truth the
 * terminal `--verbose` renderer reads from.
 */
function buildTransitivePackages(
  uniqueDependencies: string[] | undefined,
  dag: DecodedDag | null,
  includeImporters: boolean,
): LeanTransitivePackage[] | null {
  if (!uniqueDependencies || uniqueDependencies.length === 0) return null;

  // Build a name→importers lookup once — only needed when we're
  // actually emitting importers.
  const incoming = includeImporters && dag ? buildIncomingEdgeMap(dag) : null;

  const out: LeanTransitivePackage[] = [];
  for (const entry of uniqueDependencies) {
    const [name, version] = parseNameAtVersion(entry);
    if (!name) continue;
    const record: LeanTransitivePackage = { name };
    if (version) record.version = version;

    if (includeImporters && dag && incoming) {
      const nodeIdx = findNodeIdx(dag, name, version);
      if (nodeIdx !== null) {
        const edges = incoming.get(nodeIdx) ?? [];
        const importers = buildImportersFromEdges(dag, edges);
        if (importers.length > 0) record.importers = importers;
      }
    }
    out.push(record);
  }
  return out;
}

function parseNameAtVersion(raw: string): [string | null, string | undefined] {
  const trimmed = raw.trim();
  if (!trimmed) return [null, undefined];
  // npm scoped names start with `@`, so split on the LAST `@`.
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx <= 0) return [trimmed, undefined];
  return [trimmed.slice(0, atIdx), trimmed.slice(atIdx + 1)];
}

function buildIncomingEdgeMap(dag: DecodedDag): Map<number, DagEdge[]> {
  const map = new Map<number, DagEdge[]>();
  for (const edge of dag.edges) {
    const list = map.get(edge.toIdx);
    if (list) list.push(edge);
    else map.set(edge.toIdx, [edge]);
  }
  return map;
}

function findNodeIdx(
  dag: DecodedDag,
  name: string,
  version: string | undefined,
): number | null {
  // Prefer exact name+version match. Fall back to name-only when
  // version is absent or the DAG's node carries no version.
  let fallback: number | null = null;
  for (let i = 0; i < dag.nodes.length; i++) {
    const n = dag.nodes[i];
    if (!n) continue;
    if (n.name !== name) continue;
    if (version && n.version === version) return i;
    if (!version && !n.version) return i;
    if (fallback === null) fallback = i;
  }
  return fallback;
}

function buildImportersFromEdges(
  dag: DecodedDag,
  edges: DagEdge[],
): LeanTransitiveImporter[] {
  const seen = new Set<string>();
  const out: LeanTransitiveImporter[] = [];
  for (const edge of edges) {
    const from = dag.nodes[edge.fromIdx];
    if (!from) continue;
    const key = `${from.name}\u0000${from.version ?? ""}\u0000${edge.constraint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const importer: LeanTransitiveImporter = { name: from.name };
    if (from.version) importer.version = from.version;
    if (edge.constraint) importer.constraint = edge.constraint;
    out.push(importer);
  }
  out.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const av = a.version ?? "";
    const bv = b.version ?? "";
    if (av !== bv) return av < bv ? -1 : 1;
    const ac = a.constraint ?? "";
    const bc = b.constraint ?? "";
    return ac < bc ? -1 : ac > bc ? 1 : 0;
  });
  return out;
}

/**
 * Promote `transitive.conflicts[]` to typed objects when every entry
 * matches the observed backend shape (`{ package_name,
 * required_versions }`). Falls back to the raw array when any entry
 * fails to decode — agents can discriminate by checking for `name` /
 * `requiredVersions` keys on the first element.
 */
function buildTypedConflicts(
  raw: UntypedGenericJSON[],
): LeanTypedConflict[] | UntypedGenericJSON[] {
  const typed: LeanTypedConflict[] = [];
  for (const entry of raw) {
    const decoded = decodeConflictEntryForEnvelope(entry);
    if (!decoded) return raw.slice(); // fall back to raw passthrough
    typed.push(decoded);
  }
  return typed;
}

function decodeConflictEntryForEnvelope(
  raw: unknown,
): LeanTypedConflict | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name =
    typeof obj.package_name === "string"
      ? obj.package_name
      : typeof obj.packageName === "string"
        ? obj.packageName
        : null;
  if (!name) return null;
  const rangesRaw = obj.required_versions ?? obj.requiredVersions;
  if (!Array.isArray(rangesRaw)) return null;
  const ranges: string[] = [];
  for (const r of rangesRaw) {
    if (typeof r === "string" && r.length > 0 && !ranges.includes(r)) {
      ranges.push(r);
    }
  }
  if (ranges.length === 0) return null;
  ranges.sort();
  return { name, requiredVersions: ranges };
}

/**
 * Promote `transitive.circularDependencies[]` to typed objects when
 * every entry matches the expected `{ cycle: string[] }` shape.
 * Raw-passthrough fallback otherwise.
 */
function buildTypedCycles(
  raw: UntypedGenericJSON[],
): LeanTypedCycle[] | UntypedGenericJSON[] {
  const typed: LeanTypedCycle[] = [];
  for (const entry of raw) {
    const decoded = decodeCycleEntryForEnvelope(entry);
    if (!decoded) return raw.slice();
    typed.push({ cycle: decoded });
  }
  return typed;
}

function decodeCycleEntryForEnvelope(raw: unknown): string[] | null {
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    return raw as string[];
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const source = obj.cycle ?? obj.packages ?? obj.path;
  if (!Array.isArray(source)) return null;
  const names = source.filter((x): x is string => typeof x === "string");
  return names.length > 0 ? names : null;
}

function buildGroup(group: DependencyGroup): LeanGroup {
  const lean: LeanGroup = {
    name: group.name,
    lifecycle: group.lifecycle,
    conditionType: group.conditionType,
    selectionMode: group.selectionMode,
    items: group.dependencies.map((dep) => {
      const entry: LeanGroupDependency = { name: dep.name };
      if (dep.constraint) entry.constraint = dep.constraint;
      return entry;
    }),
  };
  if (group.conditionValue) lean.conditionValue = group.conditionValue;
  if (group.exclusiveGroup) lean.exclusiveGroup = group.exclusiveGroup;
  if (group.fallbackPriority !== undefined) {
    lean.fallbackPriority = group.fallbackPriority;
  }
  if (group.compatibleWith && group.compatibleWith.length > 0) {
    lean.compatibleWith = group.compatibleWith.slice();
  }
  if (group.defaultEnabled !== undefined) {
    lean.defaultEnabled = group.defaultEnabled;
  }
  return lean;
}

const LIFECYCLE_ORDER: Record<string, number> = {
  runtime: 0,
  development: 1,
  build: 2,
  peer: 3,
  optional: 4,
};

function sortGroups(groups: LeanGroup[]): LeanGroup[] {
  return groups.slice().sort((a, b) => {
    const la = LIFECYCLE_ORDER[a.lifecycle] ?? 99;
    const lb = LIFECYCLE_ORDER[b.lifecycle] ?? 99;
    if (la !== lb) return la - lb;
    if (a.lifecycle === "optional") {
      const ad = a.defaultEnabled === true ? 0 : 1;
      const bd = b.defaultEnabled === true ? 0 : 1;
      if (ad !== bd) return ad - bd;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function deriveRequestedVersion(
  requested: string | undefined,
  resolved: string,
): string | undefined {
  if (requested === undefined) return undefined;
  const trimmed = requested.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === resolved) return undefined;
  return trimmed;
}

function lowerRegistry(value: string | undefined): string {
  if (!value) return "";
  const upper = value.toUpperCase();
  try {
    // biome-ignore lint/suspicious/noExplicitAny: boundary guard
    return toPkgseerRegistryLowercase(upper as any);
  } catch {
    return value.toLowerCase();
  }
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only)
// --------------------------------------------------------------------

/**
 * Semantic model (locked post-UX review):
 *
 * - **Summary row always.** Renders counts (`N direct runtime deps`
 *   plain; `+ M transitive edges · P unique packages (depth D)` when
 *   `--transitive`) and lists hidden non-runtime groups by name so the
 *   caller sees what exists without digging.
 * - **`--transitive` replaces the deps list.** Default shows direct
 *   deps; `--transitive` swaps the block to the full unique transitive
 *   list (alphabetical, one per line, `name@version`). No truncation —
 *   if you asked for transitive, you get it all.
 * - **`--verbose` with `--transitive` adds provenance.** Each
 *   transitive entry gets `(required by <importer>@<constraint>, …)`
 *   derived from the DAG edges. Best-effort decoding; if the DAG
 *   shape drifts, provenance silently degrades (list still renders).
 * - **Groups is a separate block below the deps list.** Shown when
 *   `--groups` or `--lifecycle` is set, composes cleanly with either
 *   the direct or transitive deps list above.
 * - **Conflicts / cycles section** surfaces after the transitive list
 *   only (they come from the transitive graph).
 */

export interface FormatDependenciesTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
  requestedVersion?: string;
  canonicalLifecycles?: DependencyLifecycle[];
  includeTransitive?: boolean;
  /** Caller-supplied traversal depth; surfaces in the summary row. */
  maxDepth?: number;
  /** If true, render the groups block beneath the deps list. */
  showGroups?: boolean;
}

export function formatPackageDependenciesTerminal(
  report: DependencyReport,
  options: FormatDependenciesTerminalOptions = {},
): string {
  const verbose = options.verbose ?? false;
  // Terminal verbose output renders importers, so the envelope
  // must carry them. Non-verbose terminals don't need importers;
  // skipping them keeps the intermediate payload the formatter
  // walks small.
  const payload = buildPackageDependenciesSuccessPayload(report, {
    requestedVersion: options.requestedVersion,
    canonicalLifecycles: options.canonicalLifecycles,
    includeTransitive: options.includeTransitive,
    maxDepth: options.maxDepth,
    includeImporters: verbose,
  });
  const useColors = options.useColors ?? false;
  const showGroups = options.showGroups ?? false;
  const includeTransitive = options.includeTransitive ?? false;

  const blocks: string[] = [];

  blocks.push(formatHeaderBlock(payload, useColors, showGroups));

  if (includeTransitive) {
    blocks.push(formatTransitiveDepsList(payload, verbose, useColors));
    const issues = formatConflictsAndCycles(payload, verbose, useColors);
    if (issues) blocks.push(issues);
  } else {
    blocks.push(formatDirectDepsList(payload, verbose, useColors));
  }

  if (showGroups) {
    blocks.push(formatGroupsBlock(payload, verbose, useColors));
  }

  return `${blocks.filter((b) => b.length > 0).join("\n\n")}\n`;
}

// --------------------------------------------------------------------
// Header + summary row
// --------------------------------------------------------------------

function formatHeaderBlock(
  payload: LeanDependencyReport,
  useColors: boolean,
  showGroups: boolean,
): string {
  const name = colorize(payload.name, "bold", useColors);
  const lines: string[] = [
    `${name} @ ${payload.version} · ${payload.registry}`,
  ];
  if (payload.requestedVersion) {
    lines.push(dim(`(requested ${payload.requestedVersion})`, useColors));
  }
  lines.push(formatSummaryRow(payload, useColors, showGroups));
  return lines.join("\n");
}

/**
 * Single summary row that always renders. Combines runtime / transitive
 * counts with a "Hidden: …" mention listing non-runtime groups by
 * name. When `--groups` is active the "Hidden: …" section is omitted
 * because nothing is hidden.
 */
function formatSummaryRow(
  payload: LeanDependencyReport,
  useColors: boolean,
  showGroups: boolean,
): string {
  const countParts: string[] = [];
  const runtimeCount = payload.runtime?.count ?? 0;
  if (runtimeCount === 0) {
    countParts.push("No direct runtime dependencies");
  } else {
    const noun = runtimeCount === 1 ? "dependency" : "dependencies";
    countParts.push(`${runtimeCount} direct runtime ${noun}`);
  }
  const t = payload.transitive;
  if (t) {
    if (t.edges !== undefined) {
      const edgeNoun = t.edges === 1 ? "edge" : "edges";
      countParts.push(`${t.edges} transitive ${edgeNoun}`);
    }
    if (t.uniquePackages !== undefined) {
      const pkgNoun = t.uniquePackages === 1 ? "package" : "packages";
      const depthSuffix =
        t.depth !== undefined ? ` (max depth ${t.depth})` : "";
      countParts.push(`${t.uniquePackages} unique ${pkgNoun}${depthSuffix}`);
    }
    const conflictCount = t.conflicts?.length ?? 0;
    if (conflictCount > 0) {
      const noun = conflictCount === 1 ? "conflict" : "conflicts";
      countParts.push(
        colorize(`${conflictCount} ${noun}`, "yellow", useColors),
      );
    }
    const cycleCount = t.circularDependencies?.length ?? 0;
    if (cycleCount > 0) {
      const noun = cycleCount === 1 ? "cycle" : "cycles";
      countParts.push(colorize(`${cycleCount} ${noun}`, "red", useColors));
    }
  }
  const countLine = countParts.join(" · ");

  if (showGroups) return countLine;

  const hidden = collectHiddenGroupNames(payload);
  if (hidden.length === 0) return countLine;
  const hiddenLine = dim(
    `Hidden groups: ${hidden.join(", ")} — use --groups.`,
    useColors,
  );
  return `${countLine}\n${hiddenLine}`;
}

function collectHiddenGroupNames(payload: LeanDependencyReport): string[] {
  const groups = payload.groups;
  if (!groups) return [];
  return groups.items
    .filter((g) => g.lifecycle !== "runtime")
    .map((g) => g.name);
}

// --------------------------------------------------------------------
// Direct-deps list (default view)
//
// Plain mode and --transitive share the same per-entry presentation:
//
//   Compact:  `  name@version`
//   Verbose:  `  name@version`
//             `    - <caller's constraint> required by <importer>@<importer's version>`
//
// When resolved version is unavailable (DAG wasn't in scope), falls
// back to `name  constraint` so output stays informative.
// --------------------------------------------------------------------

function formatDirectDepsList(
  payload: LeanDependencyReport,
  verbose: boolean,
  useColors: boolean,
): string {
  const runtime = payload.runtime;
  if (!runtime || runtime.count === 0) return "";
  const sorted = sortAlphabetically(runtime.items, (i) => i.name);

  if (!verbose) {
    return sorted.map((item) => `  ${formatDepLabel(item)}`).join("\n");
  }

  // Verbose: multi-line entry per dep. Direct deps have exactly one
  // importer — the root package itself.
  const rootLabel = `${payload.name}@${payload.version}`;
  return sorted
    .map((item) => {
      const head = `  ${formatDepLabel(item)}`;
      const constraintLabel = item.constraint ?? "*";
      const line = dim(
        `    - ${constraintLabel} required by ${rootLabel}`,
        useColors,
      );
      return `${head}\n${line}`;
    })
    .join("\n");
}

function formatDepLabel(item: LeanDirectDependency): string {
  if (item.version) return `${item.name}@${item.version}`;
  // Fallback when the DAG wasn't fetched / resolution failed — keep
  // the constraint so callers still see something useful.
  if (item.constraint) return `${item.name}  ${item.constraint}`;
  return item.name;
}

// --------------------------------------------------------------------
// Transitive-deps list (replaces direct when --transitive)
// --------------------------------------------------------------------

function formatTransitiveDepsList(
  payload: LeanDependencyReport,
  verbose: boolean,
  useColors: boolean,
): string {
  const packages = payload.transitive?.packages ?? [];
  if (packages.length === 0) return "";

  const sorted = [...packages].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  if (!verbose) {
    return sorted.map((pkg) => `  ${formatPackageLabel(pkg)}`).join("\n");
  }

  return sorted
    .map((pkg) => {
      const head = `  ${formatPackageLabel(pkg)}`;
      const importers = pkg.importers ?? [];
      if (importers.length === 0) return head;
      const bullets = formatImporterBullets(importers, useColors);
      return `${head}\n${bullets}`;
    })
    .join("\n");
}

function formatPackageLabel(pkg: LeanTransitivePackage): string {
  return pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name;
}

/**
 * Collapse a list of importers into one bullet per unique
 * constraint, comma-separating the `name@version` labels. Importers
 * without a constraint (fallback path) get rendered under a `*`
 * bucket so they still surface.
 */
function formatImporterBullets(
  importers: LeanTransitiveImporter[],
  useColors: boolean,
): string {
  const byConstraint = new Map<string, string[]>();
  for (const i of importers) {
    const key = i.constraint ?? "*";
    const label = i.version ? `${i.name}@${i.version}` : i.name;
    const list = byConstraint.get(key);
    if (list) {
      if (!list.includes(label)) list.push(label);
    } else {
      byConstraint.set(key, [label]);
    }
  }
  // Stable display order: sort by constraint string.
  const constraints = [...byConstraint.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return constraints
    .map((constraint) => {
      const labels = byConstraint.get(constraint) ?? [];
      labels.sort();
      return dim(
        `    - ${constraint} required by ${labels.join(", ")}`,
        useColors,
      );
    })
    .join("\n");
}

// --------------------------------------------------------------------
// Conflicts + cycles (only when --transitive)
// --------------------------------------------------------------------

function formatConflictsAndCycles(
  payload: LeanDependencyReport,
  verbose: boolean,
  useColors: boolean,
): string {
  const t = payload.transitive;
  if (!t) return "";
  const conflicts = t.conflicts ?? [];
  const cycles = t.circularDependencies ?? [];
  const lines: string[] = [];

  if (conflicts.length === 0 && cycles.length === 0) {
    lines.push(
      dim("No version conflicts or circular dependencies detected.", useColors),
    );
    return lines.join("\n");
  }
  // Non-zero compact: counts already live on the summary row and
  // `--help` covers `--verbose`. Any extra hint here is noise. The
  // full per-entry listing surfaces only under `--verbose`.
  if (!verbose) return "";
  if (conflicts.length > 0) {
    lines.push(
      colorize(`Conflicts (${conflicts.length}):`, "yellow", useColors),
    );
    const typed = isTypedConflictArray(conflicts) ? conflicts : null;
    if (typed) {
      const nameWidth = Math.max(...typed.map((c) => c.name.length));
      const sorted = [...typed].sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      for (const c of sorted) {
        const padded = `${c.name}:`.padEnd(nameWidth + 2);
        lines.push(`  ${padded}  ${c.requiredVersions.join(", ")}`);
      }
    } else {
      for (const c of conflicts) lines.push(`  ${JSON.stringify(c)}`);
    }
  }
  if (cycles.length > 0) {
    if (conflicts.length > 0) lines.push("");
    lines.push(
      colorize(`Circular dependencies (${cycles.length}):`, "red", useColors),
    );
    const typed = isTypedCycleArray(cycles) ? cycles : null;
    if (typed) {
      for (const c of typed) lines.push(`  ${c.cycle.join(" → ")}`);
    } else {
      for (const c of cycles) lines.push(`  ${JSON.stringify(c)}`);
    }
  }

  return lines.join("\n");
}

function isTypedConflictArray(
  arr: LeanTypedConflict[] | UntypedGenericJSON[],
): arr is LeanTypedConflict[] {
  const first = arr[0];
  if (!first || typeof first !== "object") return false;
  const obj = first as Record<string, unknown>;
  return typeof obj.name === "string" && Array.isArray(obj.requiredVersions);
}

function isTypedCycleArray(
  arr: LeanTypedCycle[] | UntypedGenericJSON[],
): arr is LeanTypedCycle[] {
  const first = arr[0];
  if (!first || typeof first !== "object") return false;
  const obj = first as Record<string, unknown>;
  return Array.isArray(obj.cycle);
}

/**
 * Best-effort decoder for a `transitive.conflicts[]` entry. Backend
 * ships these as `GenericJSON`; observed shape on npm:jest is:
 *
 *   {
 *     package_name: string,
 *     required_versions: string[],                // deduped constraint ranges
 *     conflicting_edges: [{ data: { version_constraint, dependency_type },
 *                           from: "npm", to: "npm" }, ...]
 *   }
 *
 * Note `from`/`to` are registry strings, not importer node IDs — so
 * per-range provenance is lost. That's a backend gap; see
 * `/tmp/githits-cli-pkg-intel-backend-gaps.md` item #9 for follow-up.
 */
interface DecodedConflict {
  name: string;
  ranges: string[];
}

function decodeConflictEntry(raw: unknown): DecodedConflict | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const name =
    typeof obj.package_name === "string"
      ? obj.package_name
      : typeof obj.packageName === "string"
        ? obj.packageName
        : null;
  if (!name) return null;
  const rangesRaw = obj.required_versions ?? obj.requiredVersions;
  if (!Array.isArray(rangesRaw)) return null;
  const ranges: string[] = [];
  for (const r of rangesRaw) {
    if (typeof r === "string" && r.length > 0 && !ranges.includes(r)) {
      ranges.push(r);
    }
  }
  if (ranges.length === 0) return null;
  ranges.sort();
  return { name, ranges };
}

/**
 * Best-effort decoder for a `transitive.circularDependencies[]` entry.
 * No live observation yet; designed to handle plausible shapes:
 *
 *   { cycle: string[] }            — array of package names along the loop
 *   { packages: string[] }         — alias
 *   string[]                       — a bare array
 */
function decodeCycleEntry(raw: unknown): string[] | null {
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    return raw as string[];
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const source = obj.cycle ?? obj.packages ?? obj.path;
  if (!Array.isArray(source)) return null;
  const names = source.filter((x): x is string => typeof x === "string");
  return names.length > 0 ? names : null;
}

// --------------------------------------------------------------------
// Groups block (separate; shown when --groups or --lifecycle)
// --------------------------------------------------------------------

function formatGroupsBlock(
  payload: LeanDependencyReport,
  verbose: boolean,
  useColors: boolean,
): string {
  const groups = payload.groups;
  const lines: string[] = [];

  if (!groups || groups.items.length === 0) {
    lines.push(
      payload.filter
        ? `No dependency groups matched lifecycle filter: ${payload.filter.lifecycles.join(", ")}.`
        : "No dependency groups available.",
    );
    return lines.join("\n");
  }

  const summary = summariseGroupsByLifecycle(groups.items);
  const groupNoun = groups.items.length === 1 ? "group" : "groups";
  lines.push(
    colorize(
      `${groups.items.length} ${groupNoun} (${summary}):`,
      "bold",
      useColors,
    ),
  );
  lines.push("");

  if (
    verbose &&
    groups.environmentConstraints &&
    groups.environmentConstraints.length > 0
  ) {
    lines.push(
      dim(
        `environmentConstraints (${groups.environmentConstraints.length}):`,
        useColors,
      ),
    );
    for (const entry of groups.environmentConstraints) {
      lines.push(dim(`  ${JSON.stringify(entry)}`, useColors));
    }
    lines.push("");
  }

  for (const group of groups.items) {
    const heading = formatGroupHeading(group, payload.registry);
    lines.push(`  ${colorize(heading, "bold", useColors)}`);
    if (verbose) {
      const metaLines = formatGroupMeta(group);
      for (const meta of metaLines) {
        lines.push(`    ${dim(meta, useColors)}`);
      }
    }
    const deps = sortAlphabetically(
      dedupeGroupItems(group.items),
      (d) => d.name,
    );
    if (deps.length === 0) {
      lines.push(`    ${dim("(no dependencies)", useColors)}`);
    } else {
      const nameWidth = Math.max(...deps.map((d) => d.name.length));
      for (const dep of deps) {
        const name = dep.name.padEnd(nameWidth);
        const constraint = dep.constraint ?? "";
        lines.push(`    ${name}  ${constraint}`.trimEnd());
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function formatGroupHeading(group: LeanGroup, registry: string): string {
  if (group.conditionType === "always") {
    return group.name;
  }
  const displayCondition = displayConditionType(group.conditionType, registry);
  const showValue =
    group.conditionValue !== undefined &&
    group.conditionValue.toLowerCase() !== group.name.toLowerCase();
  const tail = showValue
    ? `${displayCondition}: ${group.conditionValue}`
    : displayCondition;
  return `${group.name} (${group.lifecycle}, ${tail})`;
}

/**
 * Map the backend's internal `conditionType` vocabulary to the noun
 * each ecosystem uses in its own documentation. PyPI calls feature-
 * gated dependency groups "extras" (PEP 508); Crates calls them
 * "features". Other ecosystems keep the backend term since they
 * either don't surface these groups or use the raw token.
 */
function displayConditionType(conditionType: string, registry: string): string {
  if (conditionType === "feature" && registry === "pypi") return "extra";
  return conditionType;
}

function formatGroupMeta(group: LeanGroup): string[] {
  const rows: string[] = [];
  // Suppress `selectionMode: required` — it's the uninteresting default
  // for always-typed groups (runtime/development).
  if (group.selectionMode !== "required") {
    rows.push(`selectionMode: ${group.selectionMode}`);
  }
  if (group.defaultEnabled !== undefined) {
    rows.push(`defaultEnabled: ${group.defaultEnabled}`);
  }
  if (group.exclusiveGroup) {
    rows.push(`exclusiveGroup: ${group.exclusiveGroup}`);
  }
  if (group.fallbackPriority !== undefined) {
    rows.push(`fallbackPriority: ${group.fallbackPriority}`);
  }
  if (group.compatibleWith && group.compatibleWith.length > 0) {
    rows.push(`compatibleWith: ${group.compatibleWith.join(", ")}`);
  }
  return rows;
}

/**
 * Terminal-only dedup. Collapses duplicate `{name, constraint}` tuples
 * inside a single group (common on Crates feature groups with
 * target-cfg branching). JSON envelope preserves duplicates verbatim.
 */
function dedupeGroupItems(items: LeanGroupDependency[]): LeanGroupDependency[] {
  const seen = new Set<string>();
  const out: LeanGroupDependency[] = [];
  for (const item of items) {
    const key = `${item.name}\u0000${item.constraint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function summariseGroupsByLifecycle(groups: LeanGroup[]): string {
  const counts = new Map<string, number>();
  for (const g of groups) {
    counts.set(g.lifecycle, (counts.get(g.lifecycle) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const lc of ["runtime", "development", "build", "peer", "optional"]) {
    const n = counts.get(lc);
    if (n && n > 0) parts.push(`${n} ${lc}`);
  }
  return parts.join(", ") || "0";
}

function sortAlphabetically<T>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  return items.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// --------------------------------------------------------------------
// Best-effort DAG decoder + provenance lookup
//
// Backend declares `transitive.dag` as `GenericJSON`. The shape we've
// observed live (npm, PyPI, Crates) is:
//
//   {
//     n: Array<[registry, name, version]>  // node list, indexed by position
//     e: Array<[fromIdx, toIdx, constraint?, lifecycle?]>
//     v: number                            // format version marker
//   }
//
// The decoder also tolerates the object-shape documented by
// `pkgseer-cli` (`n: { id: { n, v?, l? } }`) so that if backend
// formats diverge we don't break the terminal — provenance just
// silently stops rendering.
// --------------------------------------------------------------------

interface DagNode {
  name: string;
  version?: string;
  registry?: string;
}

interface DagEdge {
  fromIdx: number;
  toIdx: number;
  constraint?: string;
  lifecycle?: string;
}

interface DecodedDag {
  nodes: DagNode[];
  edges: DagEdge[];
}

function decodeDag(raw: unknown): DecodedDag | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawNodes = obj.n ?? obj.nodes;
  const rawEdges = obj.e ?? obj.edges;

  const nodes = decodeNodes(rawNodes);
  if (!nodes) return null;
  const edges = decodeEdges(rawEdges);
  if (!edges) return null;
  return { nodes, edges };
}

function decodeNodes(raw: unknown): DagNode[] | null {
  if (Array.isArray(raw)) {
    // Tuple form: [registry, name, version]
    const result: DagNode[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry)) {
        if (typeof entry === "object" && entry !== null) {
          const n = decodeObjectNode(entry as Record<string, unknown>);
          if (!n) return null;
          result.push(n);
          continue;
        }
        return null;
      }
      const [registry, name, version] = entry as unknown[];
      if (typeof name !== "string") return null;
      result.push({
        name,
        version: typeof version === "string" ? version : undefined,
        registry: typeof registry === "string" ? registry : undefined,
      });
    }
    return result;
  }
  if (raw && typeof raw === "object") {
    // Object form: { "<id>": { n: name, v?: version, l?: label } }
    const result: DagNode[] = [];
    for (const entry of Object.values(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") return null;
      const n = decodeObjectNode(entry as Record<string, unknown>);
      if (!n) return null;
      result.push(n);
    }
    return result;
  }
  return null;
}

function decodeObjectNode(entry: Record<string, unknown>): DagNode | null {
  const name =
    typeof entry.n === "string"
      ? entry.n
      : typeof entry.name === "string"
        ? entry.name
        : null;
  if (!name) return null;
  const version =
    typeof entry.v === "string"
      ? entry.v
      : typeof entry.version === "string"
        ? entry.version
        : undefined;
  return { name, version };
}

function decodeEdges(raw: unknown): DagEdge[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DagEdge[] = [];
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      const [from, to, constraint, lifecycle] = entry as unknown[];
      if (typeof from !== "number" || typeof to !== "number") return null;
      out.push({
        fromIdx: from,
        toIdx: to,
        constraint: typeof constraint === "string" ? constraint : undefined,
        lifecycle: typeof lifecycle === "string" ? lifecycle : undefined,
      });
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const from = obj.f ?? obj.from;
      const to = obj.t ?? obj.to;
      if (typeof from !== "number" || typeof to !== "number") return null;
      out.push({
        fromIdx: from,
        toIdx: to,
        constraint: typeof obj.c === "string" ? obj.c : undefined,
        lifecycle: typeof obj.l === "string" ? obj.l : undefined,
      });
      continue;
    }
    return null;
  }
  return out;
}

interface ProvenanceEntry {
  name: string;
  constraint?: string;
  /**
   * The importer's own resolved version (e.g. `express@5.2.1` →
   * `"5.2.1"`). Populated when {@link buildProvenanceLookup} was
   * called with `includeImporterVersion = true` and the DAG node
   * for the importer carried a version. Optional because older
   * DAG shapes may lack version metadata.
   */
  importerVersion?: string;
}

/**
 * Build a lookup `key → importers[]` where `key` matches the strings
 * in `transitive.uniqueDependencies`. Observed backend strings are
 * `name@version`; we index by both `name@version` and bare `name` so
 * either form works.
 *
 * When `includeImporterVersion` is true, each entry carries the
 * importer's own resolved version — used by the multi-line verbose
 * renderer to display `- <constraint> required by <importer>@<version>`.
 */
function buildProvenanceLookup(
  dag: DecodedDag,
  includeImporterVersion = false,
): Map<string, ProvenanceEntry[]> {
  const nodes = dag.nodes;
  const incoming = new Map<number, DagEdge[]>();
  for (const edge of dag.edges) {
    const list = incoming.get(edge.toIdx);
    if (list) {
      list.push(edge);
    } else {
      incoming.set(edge.toIdx, [edge]);
    }
  }

  const lookup = new Map<string, ProvenanceEntry[]>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const importers = incoming.get(i) ?? [];
    const entries: ProvenanceEntry[] = [];
    const seen = new Set<string>();
    for (const edge of importers) {
      const from = nodes[edge.fromIdx];
      if (!from) continue;
      const key = `${from.name}\u0000${from.version ?? ""}\u0000${edge.constraint ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry: ProvenanceEntry = {
        name: from.name,
        constraint: edge.constraint,
      };
      if (includeImporterVersion && from.version) {
        entry.importerVersion = from.version;
      }
      entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      const av = a.importerVersion ?? "";
      const bv = b.importerVersion ?? "";
      return av < bv ? -1 : av > bv ? 1 : 0;
    });

    // Index by both `name@version` and bare `name`.
    if (node.version) {
      lookup.set(`${node.name}@${node.version}`, entries);
    }
    const existingBare = lookup.get(node.name);
    if (existingBare) {
      // Multiple versions of the same name — merge importers.
      for (const e of entries) {
        const key = `${e.name}\u0000${e.importerVersion ?? ""}\u0000${e.constraint ?? ""}`;
        if (
          !existingBare.some(
            (x) =>
              `${x.name}\u0000${x.importerVersion ?? ""}\u0000${x.constraint ?? ""}` ===
              key,
          )
        ) {
          existingBare.push(e);
        }
      }
    } else {
      lookup.set(node.name, [...entries]);
    }
  }
  return lookup;
}
