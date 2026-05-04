/**
 * Hand-crafted response envelope for the `package_dependencies` tool.
 * Shared by CLI `--json` output and MCP `content[0].text`. The terminal
 * formatter is CLI-only; it reads from the same envelope shape agents
 * consume so the two surfaces can never drift.
 *
 * Key design commitments:
 *
 * - **Runtime-first envelope.** Whenever the backend returned
 *   `dependencies.direct`, we emit a `runtime` block with
 *   `{count, items: [{name, version?, constraint?}]}`. Non-runtime
 *   dependency groups are emitted only when the caller requested a
 *   lifecycle view (`lifecycle=<phase>` or `lifecycle=all`).
 * - **Preprocessed transitive.** When the caller sets
 *   `includeTransitive`, the envelope's `transitive.packages[]` lists
 *   every unique install with its resolved version. Adding
 *   `includeImporters` populates per-package `importers[]` with the
 *   upstream node name, its own version, and the constraint it
 *   declared — the same signal the terminal `--verbose` view
 *   renders, derived client-side from the typed dependency graph
 *   so agents never see the graph directly.
 * - **Typed conflicts / cycles.** `transitive.conflicts` is
 *   `{name, requiredVersions}[]`; `transitive.circularDependencies`
 *   is `{cycle: string[]}[]`. Both map from the backend's typed
 *   `DependencyConflict` / `CircularDependencyCycle` shapes — no
 *   raw-fallback path.
 * - **Null vs empty matters.** No lifecycle request or
 *   `dependencyGroups: null` → omit `groups` entirely. Requested
 *   lifecycle with zero members after filtering → `groups: { items: [] }`
 *   ("filter matched nothing").
 * - **No DAG in the envelope.** The typed `dependencyGraph` sits on
 *   the service-layer result for internal lookups (direct-version
 *   resolution, importer provenance) and for a future `pkg deps-dag`
 *   command; this tool's envelope deliberately doesn't surface it.
 * - **Typed environment markers.** `groups.environmentMarkers` maps
 *   the backend's typed `{type, value, raw}` marker list. No raw-JSON
 *   passthrough.
 * - **No v-prefix normalisation.** Tag-style inputs are rejected in
 *   the request builder before we get here.
 * - **Terminal-only dedup.** JSON preserves every tuple the backend
 *   sent (including Crates target-cfg duplicates). Terminal
 *   rendering strips duplicates inside each group for scannability.
 */

import type {
  DependencyGraph,
  DependencyGroup,
  DependencyReport,
  EnvironmentMarker,
} from "../services/index.js";
import { colorize, dim } from "./colors.js";
import type {
  DependencyLifecycle,
  DependencyLifecycleInput,
} from "./package-dependencies-request.js";
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

export interface LeanEnvironmentMarker {
  type?: string;
  value?: string;
  raw?: string;
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
  environmentMarkers?: LeanEnvironmentMarker[];
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
   * Importers for this package. Present when the DAG was available
   * and the node resolved. Empty when the package is the root (no
   * incoming edges).
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
   * provenance. Preprocessed from the backend's typed dependency graph
   * so agents consume the same signal the CLI `--verbose` view renders.
   */
  packages?: LeanTransitivePackage[];
  conflicts?: LeanTypedConflict[];
  circularDependencies?: LeanTypedCycle[];
}

export interface LeanFilterBlock {
  lifecycles: DependencyLifecycleInput[];
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
  canonicalLifecycles?: DependencyLifecycleInput[];
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
  // Direct-version lookup uses the typed dependency graph's
  // root-outgoing edges. Null when the graph wasn't fetched.
  const graph = bundle?.transitive?.dependencyGraph ?? null;
  const directVersionByName = graph ? buildDirectVersionLookup(graph) : null;

  const directArray = bundle?.direct;
  if (directArray !== undefined) {
    const items = directArray.map((entry) =>
      buildDirect(entry, directVersionByName),
    );
    payload.runtime = { count: items.length, items };
  }

  const groupsInfo = report.dependencyGroups;
  if (
    groupsInfo !== undefined &&
    shouldEmitGroups(options.canonicalLifecycles)
  ) {
    const groupItems = sortGroups(
      groupsInfo.groups.map(buildGroup).filter((group) => {
        if (!options.canonicalLifecycles) return false;
        if (options.canonicalLifecycles.includes("all")) return true;
        return options.canonicalLifecycles.includes(
          group.lifecycle as DependencyLifecycle,
        );
      }),
    );
    const groupsBlock: LeanGroupsBlock = { items: groupItems };
    if (
      groupsInfo.primaryGroup &&
      groupItems.some((group) => group.name === groupsInfo.primaryGroup)
    ) {
      groupsBlock.primaryGroup = groupsInfo.primaryGroup;
    }
    if (
      groupsInfo.environmentMarkers &&
      groupsInfo.environmentMarkers.length > 0
    ) {
      groupsBlock.environmentMarkers = groupsInfo.environmentMarkers.map((m) =>
        projectEnvironmentMarker(m),
      );
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
        graph,
        options.includeImporters ?? false,
      );
      if (packages && packages.length > 0) {
        block.packages = packages;
      }
      if (
        transitive.dependencyConflicts &&
        transitive.dependencyConflicts.length > 0
      ) {
        block.conflicts = transitive.dependencyConflicts.map((c) => ({
          name: c.packageName,
          requiredVersions: c.requiredVersions.slice().sort(),
        }));
      }
      if (
        transitive.circularDependencyCycles &&
        transitive.circularDependencyCycles.length > 0
      ) {
        block.circularDependencies = transitive.circularDependencyCycles.map(
          (c) => ({ cycle: c.circularPath.slice() }),
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

function shouldEmitGroups(
  lifecycles: DependencyLifecycleInput[] | undefined,
): boolean {
  if (!lifecycles || lifecycles.length === 0) return false;
  return lifecycles.some((entry) => entry !== "runtime");
}

function projectEnvironmentMarker(
  marker: EnvironmentMarker,
): LeanEnvironmentMarker {
  const out: LeanEnvironmentMarker = {};
  if (marker.type !== undefined) out.type = marker.type;
  if (marker.value !== undefined) out.value = marker.value;
  if (marker.raw !== undefined) out.raw = marker.raw;
  return out;
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
 * Build a `name → resolved version` lookup for direct deps by walking
 * edges whose `fromIndex` points at the graph's root (the node with
 * no incoming edges). Returns null when the graph has no single root
 * — synthetic-root edges (`fromIndex: null`) are treated as
 * originating from the root as well.
 */
function buildDirectVersionLookup(
  graph: DependencyGraph,
): Map<string, string> | null {
  const rootIdx = findRootNodeIdx(graph);
  const out = new Map<string, string>();
  for (const edge of graph.edges) {
    const fromRoot =
      edge.fromIndex === undefined ||
      edge.fromIndex === null ||
      edge.fromIndex === rootIdx;
    if (!fromRoot) continue;
    const node = graph.nodes[edge.toIndex];
    if (!node || !node.version) continue;
    if (!out.has(node.name)) {
      out.set(node.name, node.version);
    }
  }
  return out.size > 0 ? out : null;
}

function findRootNodeIdx(graph: DependencyGraph): number | null {
  const incoming = new Set<number>();
  for (const e of graph.edges) incoming.add(e.toIndex);
  let root: number | null = null;
  for (let i = 0; i < graph.nodes.length; i++) {
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
 * `uniqueDependencies` list) plus importer provenance when the graph
 * was fetched. Agents consume this directly rather than the raw
 * dependency graph.
 */
function buildTransitivePackages(
  uniqueDependencies: string[] | undefined,
  graph: DependencyGraph | null,
  includeImporters: boolean,
): LeanTransitivePackage[] | null {
  if (!uniqueDependencies || uniqueDependencies.length === 0) return null;

  // Build a name→importers lookup once — only needed when we're
  // actually emitting importers.
  const incoming =
    includeImporters && graph ? buildIncomingEdgeMap(graph) : null;

  const out: LeanTransitivePackage[] = [];
  for (const entry of uniqueDependencies) {
    const [name, version] = parseNameAtVersion(entry);
    if (!name) continue;
    const record: LeanTransitivePackage = { name };
    if (version) record.version = version;

    if (includeImporters && graph && incoming) {
      const nodeIdx = findNodeIdx(graph, name, version);
      if (nodeIdx !== null) {
        const edges = incoming.get(nodeIdx) ?? [];
        const importers = buildImportersFromEdges(graph, edges);
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

function buildIncomingEdgeMap(
  graph: DependencyGraph,
): Map<number, DependencyGraph["edges"]> {
  const map = new Map<number, DependencyGraph["edges"]>();
  for (const edge of graph.edges) {
    const list = map.get(edge.toIndex);
    if (list) list.push(edge);
    else map.set(edge.toIndex, [edge]);
  }
  return map;
}

function findNodeIdx(
  graph: DependencyGraph,
  name: string,
  version: string | undefined,
): number | null {
  // Prefer exact name+version match. Fall back to name-only when
  // version is absent or the graph's node carries no version.
  let fallback: number | null = null;
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    if (!n) continue;
    if (n.name !== name) continue;
    if (version && n.version === version) return i;
    if (!version && !n.version) return i;
    if (fallback === null) fallback = i;
  }
  return fallback;
}

function buildImportersFromEdges(
  graph: DependencyGraph,
  edges: DependencyGraph["edges"],
): LeanTransitiveImporter[] {
  const seen = new Set<string>();
  const out: LeanTransitiveImporter[] = [];
  for (const edge of edges) {
    // Synthetic-root edges have `fromIndex: null` — skip; the root
    // is the package itself and doesn't need to show up as an
    // importer of its direct deps.
    if (edge.fromIndex === undefined || edge.fromIndex === null) continue;
    const from = graph.nodes[edge.fromIndex];
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
 *   derived from the typed dependency graph.
 * - **Groups is a separate block below the deps list.** Shown when
 *   `--lifecycle` is a non-runtime value or `all`, and composes cleanly with either
 *   the direct or transitive deps list above.
 * - **Conflicts / cycles section** surfaces after the transitive list
 *   only (they come from the transitive graph).
 */

export interface FormatDependenciesTerminalOptions {
  verbose?: boolean;
  useColors?: boolean;
  requestedVersion?: string;
  canonicalLifecycles?: DependencyLifecycleInput[];
  includeTransitive?: boolean;
  /** Caller-supplied traversal depth; surfaces in the summary row. */
  maxDepth?: number;
  /** If true, render the groups block beneath the deps list. */
  showGroups?: boolean;
  hiddenGroupsHint?: string;
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
    canonicalLifecycles: options.canonicalLifecycles ?? ["all"],
    includeTransitive: options.includeTransitive,
    maxDepth: options.maxDepth,
    includeImporters: verbose,
  });
  const useColors = options.useColors ?? false;
  const showGroups = options.showGroups ?? false;
  const includeTransitive = options.includeTransitive ?? false;

  const blocks: string[] = [];

  blocks.push(formatHeaderBlock(payload, useColors, showGroups, options));

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
  options: FormatDependenciesTerminalOptions,
): string {
  const name = colorize(payload.name, "bold", useColors);
  const lines: string[] = [
    `${name} @ ${payload.version} · ${payload.registry}`,
  ];
  if (payload.requestedVersion) {
    lines.push(dim(`(requested ${payload.requestedVersion})`, useColors));
  }
  lines.push(formatSummaryRow(payload, useColors, showGroups, options));
  return lines.join("\n");
}

/**
 * Single summary row that always renders. Combines runtime / transitive
 * counts with a "Hidden: …" mention listing non-runtime groups by
 * name. When the groups view is active the "Hidden: …" section is omitted
 * because nothing is hidden.
 */
function formatSummaryRow(
  payload: LeanDependencyReport,
  useColors: boolean,
  showGroups: boolean,
  options: FormatDependenciesTerminalOptions,
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
    `Hidden groups: ${hidden.join(", ")} — ${options.hiddenGroupsHint ?? "use --lifecycle all."}`,
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
    const nameWidth = Math.max(...conflicts.map((c) => c.name.length));
    const sorted = [...conflicts].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const c of sorted) {
      const padded = `${c.name}:`.padEnd(nameWidth + 2);
      lines.push(`  ${padded}  ${c.requiredVersions.join(", ")}`);
    }
  }
  if (cycles.length > 0) {
    if (conflicts.length > 0) lines.push("");
    lines.push(
      colorize(`Circular dependencies (${cycles.length}):`, "red", useColors),
    );
    for (const c of cycles) lines.push(`  ${c.cycle.join(" → ")}`);
  }

  return lines.join("\n");
}

// --------------------------------------------------------------------
// Groups block (separate; shown for non-runtime lifecycle views)
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
    groups.environmentMarkers &&
    groups.environmentMarkers.length > 0
  ) {
    lines.push(
      dim(
        `environmentMarkers (${groups.environmentMarkers.length}):`,
        useColors,
      ),
    );
    for (const marker of groups.environmentMarkers) {
      lines.push(dim(`  ${formatEnvironmentMarker(marker)}`, useColors));
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

/**
 * Render a typed environment marker as `type: value` (falling back
 * to the raw text when either field is missing). Keeps verbose
 * output compact — one line per marker.
 */
function formatEnvironmentMarker(marker: LeanEnvironmentMarker): string {
  if (marker.type && marker.value) return `${marker.type}: ${marker.value}`;
  if (marker.value) return marker.value;
  if (marker.type) return marker.type;
  return marker.raw ?? "(empty marker)";
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
