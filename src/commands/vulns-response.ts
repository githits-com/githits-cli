import {
  type AdvisoryDetails,
  type AdvisoryLookup,
  type LookupPackage,
  type LookupUnknown,
  type OsvSourceMetadata,
  parsePkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  isPlaceholderSummary,
  supportsVulnerabilitiesRegistry,
} from "@githits/mcp/internal";

export interface VulnsError {
  error: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
export interface VulnsResult {
  inputId: string;
  status: "success" | "partial" | "error";
  lookup?: AdvisoryLookup;
  packagePagination?: { complete: boolean; pagesRead: number };
  error?: VulnsError;
}
/** Preserve source severity text without overloading a numeric CVSS score. */
export type VulnsReportedSeverity = {
  type: string;
  source?: string;
} & ({ vector: string } | { value: string });

export interface VulnsOriginalAffected {
  package?: { name: string; ecosystem: string; purl?: string };
  severity?: VulnsReportedSeverity[];
  versions?: string[];
  ranges?: Array<{
    type: string;
    repo?: string;
    events: Array<{
      introduced?: string;
      fixed?: string;
      lastAffected?: string;
      limit?: string;
    }>;
  }>;
}
export interface VulnsSourceMetadata {
  aliases?: string[];
  publishedAt?: string;
  modifiedAt?: string;
}
export interface VulnsSourceDetail extends VulnsSourceMetadata {
  originalAffected?: VulnsOriginalAffected[];
  normalization?: { filtered: boolean; modifications: string[] };
}
export interface VulnsSource extends VulnsSourceMetadata {
  id?: string;
  /** Relationship to the resolved advisory; absent when no advisory was resolved. */
  relationship?: "advisory" | "alias" | "related";
  origin: "live" | "local";
  url: string;
  summary?: string;
  /** Source-reported CVSS only; numeric stand-ins for severity labels are omitted. */
  severity?: { score: number; type: "CVSS_V2" | "CVSS_V3" | "CVSS_V4" };
  withdrawnAt?: string;
  malicious?: true;
}
export interface VulnsEvidence {
  /** Backend-normalized spans; null means unavailable, [] means none reported. */
  affectedRanges: string[] | null;
  /** Independent source fix list; no positional range-to-fix mapping is provided. */
  sourceFixVersions: string[] | null;
  /** Zero-based indexes into this result's sources, never global or backend IDs. */
  sourceIndexes: number[];
  affectedTruncated?: true;
  affectedTotal?: number;
  affectedDisplay?: {
    ranges: string[];
    totalCount: number;
    truncated: boolean;
  };
  details?: Array<{
    sourceIndex: number;
    originalAffected?: VulnsOriginalAffected[];
    /** Zero-based indexes into advisory.originalAffected, preserving source order. */
    advisoryAffectedIndexes?: number[];
    normalization?: { filtered: boolean; modifications: string[] };
    reportedPackage?: { registry?: string; name?: string };
    rawAffected?: string[] | null;
  }>;
}
export interface VulnsPackage {
  target?: string;
  name?: string;
  registry?: string;
  ecosystem?: string;
  url?: string;
  /** When present, identifies what must be resolved before using target for assessment. */
  assessment?:
    | "module_or_toolchain"
    | "unsupported_registry"
    | "unverified_provider";
  evidence: VulnsEvidence[];
}
export interface VulnsDiagnostic {
  code: string;
  message: string;
  retryable: boolean;
  section?: string;
  packageIndex?: number;
  candidateIds?: string[];
  candidateIdsTruncated?: true;
  action?: string;
  hint?: string;
  retryAfterSeconds?: number;
  notAttempted?: true;
}
export interface VulnsReport {
  inputId: string;
  status: VulnsResult["status"];
  advisory?: VulnsSourceDetail &
    Partial<OsvSourceMetadata> & {
      id: string;
      url: string;
      summary?: string;
      withdrawnAt?: string;
      explanation?: string;
      severity?: VulnsReportedSeverity[];
      references?: Array<{ type: string; url: string | null }>;
    };
  sources?: VulnsSource[];
  packages?: VulnsPackage[];
  coverage?: {
    live: string;
    local: string;
    returned: number;
    total: number;
    complete: boolean;
  };
  diagnostics?: VulnsDiagnostic[];
}
export interface VulnsResponse {
  results: VulnsReport[];
}

/** CLI projection: source facts once, package evidence with explicit source references. */
export function buildVulnsResponse(
  results: VulnsResult[],
  options: { verbose?: boolean } = {},
): VulnsResponse {
  return {
    results: results.map((result) =>
      buildReport(result, options.verbose === true),
    ),
  };
}

function buildReport(result: VulnsResult, verbose: boolean): VulnsReport {
  const report: VulnsReport = {
    inputId: result.inputId,
    status: result.status,
  };
  const lookup = result.lookup;
  const advisory = lookup?.advisory;
  if (advisory) {
    report.advisory = {
      id: advisory.osvId,
      url: advisory.sourceUrl,
      ...(advisory.summary && !isPlaceholderSummary(advisory.summary)
        ? { summary: advisory.summary }
        : {}),
      ...(advisory.withdrawnAt !== null
        ? { withdrawnAt: advisory.withdrawnAt }
        : {}),
      ...(verbose
        ? {
            ...sourceDetail(advisory),
            schemaVersion: advisory.schemaVersion,
            relatedIds: advisory.relatedIds,
            upstreamIds: advisory.upstreamIds,
            credits: advisory.credits,
            ...(advisory.details ? { explanation: advisory.details } : {}),
            ...(advisory.severity?.length
              ? { severity: advisory.severity.map(reportedSeverity) }
              : {}),
            ...(advisory.references?.length
              ? { references: advisory.references }
              : {}),
          }
        : {}),
    };
  }
  const connection = lookup?.affectedPackages;
  if (connection) {
    const sources: VulnsSource[] = [];
    const sourceKeys: string[] = [];
    const intern = (source: VulnsSource): number => {
      const key = JSON.stringify(source);
      const found = sourceKeys.indexOf(key);
      if (found !== -1) return found;
      sourceKeys.push(key);
      sources.push(source);
      return sources.length - 1;
    };
    report.packages = connection.entries.map((group) => {
      const registry = group.package.registry
        ? parsePkgseerRegistryArg(group.package.registry)
        : undefined;
      const target = registry ? `${registry}:${group.package.name}` : undefined;
      const url = packageUrl(registry, group.package.name);
      const pkg: VulnsPackage = {
        ...(target
          ? { target }
          : {
              name: group.package.name,
              ...(group.package.registry
                ? { registry: group.package.registry }
                : {}),
              ...(group.package.ecosystem
                ? { ecosystem: group.package.ecosystem }
                : {}),
            }),
        ...(url ? { url } : {}),
        ...(registry === "go"
          ? { assessment: "module_or_toolchain" as const }
          : !registry ||
              !supportsVulnerabilitiesRegistry(toPkgseerRegistry(registry))
            ? { assessment: "unsupported_registry" as const }
            : registry === "swift" && !url
              ? { assessment: "unverified_provider" as const }
              : {}),
        evidence: [],
      };
      const rawKeys = new Map<VulnsEvidence, string>();
      const add = (
        row:
          | NonNullable<LookupPackage["sourceEvidence"]>
          | LookupPackage["advisories"][number],
        origin: VulnsSource["origin"],
      ): void => {
        const source: VulnsSource = {
          ...(row.osvId ? { id: row.osvId } : {}),
          ...(advisory
            ? {
                relationship:
                  row.osvId === advisory.osvId
                    ? ("advisory" as const)
                    : (row.osvId && advisory.aliases?.includes(row.osvId)) ||
                        ("aliases" in row &&
                          row.aliases?.includes(advisory.osvId))
                      ? ("alias" as const)
                      : ("related" as const),
              }
            : {}),
          origin,
          url: row.sourceUrl,
          ...("summary" in row &&
          row.summary &&
          !isPlaceholderSummary(row.summary) &&
          row.summary !== advisory?.summary
            ? { summary: row.summary }
            : {}),
          ...("severityScore" in row &&
          row.severityScore !== null &&
          (row.severityType === "CVSS_V2" ||
            row.severityType === "CVSS_V3" ||
            row.severityType === "CVSS_V4")
            ? {
                severity: {
                  score: row.severityScore,
                  type: row.severityType,
                },
              }
            : {}),
          ...(row.withdrawnAt !== null ? { withdrawnAt: row.withdrawnAt } : {}),
          ...("isMalicious" in row && row.isMalicious === true
            ? { malicious: true as const }
            : {}),
          ...(verbose ? sourceMetadata(row) : {}),
        };
        const index = intern(source);
        const rawAffected = row.affectedVersionRanges;
        const display = row.affectedVersionDisplay;
        const completeDisplay = Boolean(
          display?.ranges.length &&
            !display.truncated &&
            pkg.assessment !== "unsupported_registry",
        );
        const affected =
          rawAffected === null
            ? null
            : display?.ranges.length
              ? display.ranges
              : rawAffected.slice(0, 10);
        const truncated =
          rawAffected !== null &&
          (display?.ranges.length
            ? display.truncated
            : rawAffected.length > 10);
        const total = display?.ranges.length
          ? display.totalCount
          : rawAffected?.length;
        const fixed = row.fixedInVersions;
        const rawKey = JSON.stringify([
          rawAffected,
          fixed,
          affected,
          truncated,
          total,
        ]);
        const previous =
          rawAffected !== null
            ? pkg.evidence.find((evidence) => rawKeys.get(evidence) === rawKey)
            : undefined;
        const { originalAffected, ...content } = verbose
          ? sourceContent(row)
          : {};
        const advisoryAffectedIndexes =
          advisory && row.osvId === advisory.osvId
            ? originalAffected?.map(
                (entry) =>
                  report.advisory?.originalAffected?.findIndex(
                    (root) => JSON.stringify(root) === JSON.stringify(entry),
                  ) ?? -1,
              )
            : undefined;
        const differentPackage =
          verbose &&
          "packageName" in row &&
          ((row.packageName && row.packageName !== group.package.name) ||
            (row.registry && row.registry !== group.package.registry));
        const detail = {
          ...content,
          ...(originalAffected
            ? advisoryAffectedIndexes?.every((index) => index >= 0)
              ? { advisoryAffectedIndexes }
              : { originalAffected }
            : {}),
          ...(verbose &&
          !completeDisplay &&
          JSON.stringify(affected) !== JSON.stringify(rawAffected)
            ? { rawAffected }
            : {}),
          ...(differentPackage
            ? {
                reportedPackage: {
                  ...(row.registry ? { registry: row.registry } : {}),
                  ...(row.packageName ? { name: row.packageName } : {}),
                },
              }
            : {}),
        };
        const scoped = Object.keys(detail).length
          ? { sourceIndex: index, ...detail }
          : undefined;
        if (previous) {
          if (!previous.sourceIndexes.includes(index))
            previous.sourceIndexes.push(index);
          if (
            scoped &&
            !previous.details?.some(
              (item) => JSON.stringify(item) === JSON.stringify(scoped),
            )
          ) {
            previous.details ??= [];
            previous.details.push(scoped);
          }
        } else {
          const evidence: VulnsEvidence = {
            affectedRanges: affected,
            sourceFixVersions: fixed,
            sourceIndexes: [index],
            ...(scoped ? { details: [scoped] } : {}),
            ...(truncated
              ? { affectedTruncated: true, affectedTotal: total }
              : {}),
            ...(affected === null && row.affectedVersionDisplay
              ? { affectedDisplay: row.affectedVersionDisplay }
              : {}),
          };
          pkg.evidence.push(evidence);
          rawKeys.set(evidence, rawKey);
        }
      };
      if (group.sourceEvidence) add(group.sourceEvidence, "live");
      for (const local of group.advisories) add(local, "local");
      return pkg;
    });
    if (sources.length) report.sources = sources;
    report.coverage = {
      live: connection.coverage.sourceStatus,
      local: connection.coverage.localStatus,
      returned: connection.entries.length,
      total: connection.pageInfo.totalCount,
      complete: result.packagePagination?.complete === true,
    };
  }
  const unknown = lookup?.unknownDetails ?? [];
  const primary = result.error;
  const diagnostics: VulnsDiagnostic[] = [];
  if (primary) {
    const detail = unknown.find(
      (d) => d.code === primary.code && d.message === primary.error,
    );
    diagnostics.push(diagnostic(primary, detail, result.inputId));
  }
  for (const detail of unknown) {
    if (
      diagnostics.some(
        (d) =>
          d.code === detail.code &&
          d.message === detail.message &&
          d.packageIndex === packageIndex(detail) &&
          d.section === detail.section,
      )
    )
      continue;
    diagnostics.push(
      diagnostic(
        {
          code: detail.code,
          error: detail.message,
          retryable: detail.retryable,
        },
        detail,
        result.inputId,
      ),
    );
  }
  if (diagnostics.length) report.diagnostics = diagnostics;
  return report;
}

function packageIndex(detail: LookupUnknown | undefined): number | undefined {
  return detail?.path?.[0] === "affectedPackages" &&
    detail.path[1] === "entries" &&
    typeof detail.path[2] === "number"
    ? detail.path[2]
    : undefined;
}
function diagnostic(
  error: VulnsError,
  detail: LookupUnknown | undefined,
  inputId: string,
): VulnsDiagnostic {
  const details = error.details ?? {};
  const action =
    typeof details.action === "string"
      ? details.action
      : typeof details.updateCommand === "string"
        ? details.updateCommand
        : error.code === "AUTH_REQUIRED"
          ? "githits login"
          : undefined;
  let hint = typeof details.hint === "string" ? details.hint : undefined;
  const id = inputId.trim();
  if (!hint && error.code === "NOT_FOUND") {
    const cased = /^cve-\d{4}-\d+$/i.test(id)
      ? id.toUpperCase()
      : /^ghsa-(?:[a-z\d]{4}-){2}[a-z\d]{4}$/i.test(id)
        ? `GHSA-${id.slice(5).toLowerCase()}`
        : id;
    if (cased !== id) hint = `IDs are case-sensitive; try ${cased}.`;
  }
  const retryAfterSeconds =
    typeof details.retryAfterSeconds === "number"
      ? details.retryAfterSeconds
      : typeof details.retryAfterMs === "number"
        ? details.retryAfterMs / 1000
        : undefined;
  const index = packageIndex(detail);
  return {
    code: error.code,
    message: error.error,
    retryable: error.retryable,
    ...(detail ? { section: detail.section } : {}),
    ...(index !== undefined ? { packageIndex: index } : {}),
    ...(detail?.candidateIds !== null && detail?.candidateIds !== undefined
      ? { candidateIds: detail.candidateIds }
      : {}),
    ...(detail?.candidateIdsTruncated ? { candidateIdsTruncated: true } : {}),
    ...(action ? { action } : {}),
    ...(hint ? { hint } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(details.notAttempted === true ? { notAttempted: true } : {}),
  };
}

interface SourceFields {
  aliases?: string[];
  publishedAt?: string | null;
  modifiedAt?: string | null;
  affected?: AdvisoryDetails["affected"];
  contentSafety?: { filtered: boolean; modifications: string[] };
}
function sourceMetadata(row: SourceFields): VulnsSourceMetadata {
  return {
    ...(row.aliases?.length ? { aliases: row.aliases } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
    ...(row.modifiedAt ? { modifiedAt: row.modifiedAt } : {}),
  };
}
function sourceContent(
  row: SourceFields,
): Pick<VulnsSourceDetail, "originalAffected" | "normalization"> {
  return {
    ...(row.affected?.length
      ? { originalAffected: row.affected.map(originalAffected) }
      : {}),
    ...(row.contentSafety &&
    (row.contentSafety.filtered || row.contentSafety.modifications.length)
      ? { normalization: row.contentSafety }
      : {}),
  };
}
function sourceDetail(row: SourceFields): VulnsSourceDetail {
  return { ...sourceMetadata(row), ...sourceContent(row) };
}
function reportedSeverity(
  item: AdvisoryDetails["severity"][number],
): VulnsReportedSeverity {
  return {
    type: item.type,
    ...(/^(CVSS:|AV:)/.test(item.score)
      ? { vector: item.score }
      : { value: item.score }),
    ...(item.source ? { source: item.source } : {}),
  };
}
function originalAffected(
  entry: AdvisoryDetails["affected"][number],
): VulnsOriginalAffected {
  return {
    ...(entry.package
      ? {
          package: {
            name: entry.package.name,
            ecosystem: entry.package.ecosystem,
            ...(entry.package.purl ? { purl: entry.package.purl } : {}),
          },
        }
      : {}),
    ...(entry.severity.length
      ? { severity: entry.severity.map(reportedSeverity) }
      : {}),
    ...(entry.versions.length ? { versions: entry.versions } : {}),
    ...(entry.ranges.length
      ? {
          ranges: entry.ranges.map((range) => ({
            type: range.type,
            ...(range.repo ? { repo: range.repo } : {}),
            events: range.events.map((event) =>
              Object.fromEntries(
                Object.entries(event).filter(([, value]) => value !== null),
              ),
            ),
          })),
        }
      : {}),
  };
}

/** Registry links use only explicit known ecosystem/provider identities, with escaped path segments. */
function packageUrl(
  registry: string | undefined,
  name: string,
): string | undefined {
  const path = name.split("/").map(encodeURIComponent).join("/");
  switch (registry) {
    case "npm":
      return `https://www.npmjs.com/package/${path}`;
    case "pypi":
      return `https://pypi.org/project/${encodeURIComponent(name)}/`;
    case "hex":
      return `https://hex.pm/packages/${encodeURIComponent(name)}`;
    case "crates":
      return `https://crates.io/crates/${encodeURIComponent(name)}`;
    case "nuget":
      return `https://www.nuget.org/packages/${encodeURIComponent(name)}`;
    case "maven": {
      const parts = name.split(":");
      return parts.length === 2
        ? `https://central.sonatype.com/artifact/${parts.map(encodeURIComponent).join("/")}`
        : undefined;
    }
    case "packagist":
      return `https://packagist.org/packages/${path}`;
    case "rubygems":
      return `https://rubygems.org/gems/${encodeURIComponent(name)}`;
    case "go":
      return name === "stdlib"
        ? "https://pkg.go.dev/std"
        : `https://pkg.go.dev/${path}`;
    case "swift":
      return name.startsWith("github.com/")
        ? `https://github.com/${name.slice(11).split("/").map(encodeURIComponent).join("/")}`
        : undefined;
    case "pub":
      return `https://pub.dev/packages/${encodeURIComponent(name)}`;
    default:
      return undefined;
  }
}
