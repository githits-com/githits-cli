import type {
  CodeDiffParams,
  CodeDiffResult,
  RawCodeDiffFile,
} from "@githits/core-internal";
import { quoteGitPath } from "./code-diff-path.js";
import type { CodeDiffView } from "./code-diff-request.js";

export type CodeDiffEnvelopeRefKind =
  | "sha"
  | "tag"
  | "branch"
  | "head"
  | "unknown";
export type CodeDiffEnvelopeVersionSource =
  | "registry"
  | "git_head"
  | "tag"
  | "release";
export type CodeDiffEnvelopeScopeStatus = "package" | "repository" | "unknown";
export type CodeDiffEnvelopeFileStatus = "added" | "deleted" | "modified";
export type CodeDiffEnvelopePathEncoding = "utf8" | "byte_escaped";
export type CodeDiffEnvelopeContentStatus =
  | "not_requested"
  | "stats"
  | "patch"
  | "binary"
  | "metadata_only"
  | "omitted"
  | "unavailable";
export type CodeDiffEnvelopeContentCoverage =
  | "not_requested"
  | "complete"
  | "partial"
  | "failed";

export interface LeanCodeDiffPackageTarget {
  kind: "package";
  registry: string;
  name: string;
  repoUrl?: string;
}

export interface LeanCodeDiffRepositoryTarget {
  kind: "repository";
  repoUrl: string;
}

export type LeanCodeDiffTarget =
  | LeanCodeDiffPackageTarget
  | LeanCodeDiffRepositoryTarget;

export interface LeanCodeDiffResolution {
  requested: string;
  resolvedVersion?: string;
  ref: string;
  commitSha: string;
  refKind: CodeDiffEnvelopeRefKind;
  versionSource?: CodeDiffEnvelopeVersionSource;
}

export interface LeanCodeDiffSummary {
  filesChanged: number;
  added: number;
  deleted: number;
  modified: number;
  modeChanged: number;
  typeChanged: number;
  inventoryComplete: boolean;
  unprojectableFiles: number;
}

export interface LeanCodeDiffScope {
  status: CodeDiffEnvelopeScopeStatus;
  fromSubpath?: string;
  toSubpath?: string;
  pathPrefix?: string;
  pathGlob?: string;
}

export interface LeanCodeDiffContentFailure {
  code: string;
  retryable: boolean;
  retryAfterMs?: number;
  stage?: string;
  limitKind?: string;
}

export interface LeanCodeDiffContentSafety {
  filtered: boolean;
  modifications: string[];
}

export interface LeanCodeDiffFileBase {
  path: string;
  pathEncoding: CodeDiffEnvelopePathEncoding;
}

export interface LeanCodeDiffNameOnlyFile extends LeanCodeDiffFileBase {}

export interface LeanCodeDiffNameStatusFile extends LeanCodeDiffFileBase {
  status: CodeDiffEnvelopeFileStatus;
}

export interface LeanCodeDiffStatFile extends LeanCodeDiffNameStatusFile {
  modeChanged: boolean;
  typeChanged: boolean;
  additions?: number;
  deletions?: number;
  contentStatus: CodeDiffEnvelopeContentStatus;
}

export interface LeanCodeDiffPatchFile extends LeanCodeDiffStatFile {
  patch?: string;
  contentOmissionReason?: string;
  contentSafety: LeanCodeDiffContentSafety;
}

export type LeanCodeDiffFile =
  | LeanCodeDiffNameOnlyFile
  | LeanCodeDiffNameStatusFile
  | LeanCodeDiffStatFile
  | LeanCodeDiffPatchFile;

export interface LeanCodeDiffEnvelope {
  target: LeanCodeDiffTarget;
  view: CodeDiffView;
  from: LeanCodeDiffResolution;
  to: LeanCodeDiffResolution;
  summary: LeanCodeDiffSummary;
  scope: LeanCodeDiffScope;
  contentCoverage: CodeDiffEnvelopeContentCoverage;
  contentFailure?: LeanCodeDiffContentFailure;
  files: LeanCodeDiffFile[];
  hasMoreFiles: boolean;
}

export interface BuildCodeDiffPayloadOptions {
  target: CodeDiffParams["target"];
  view: CodeDiffView;
}

export function buildCodeDiffSuccessPayload(
  result: CodeDiffResult,
  options: BuildCodeDiffPayloadOptions,
): LeanCodeDiffEnvelope {
  const envelope: LeanCodeDiffEnvelope = {
    target: buildTarget(result, options.target),
    view: options.view,
    from: projectResolution(result.fromResolution),
    to: projectResolution(result.toResolution),
    summary: projectSummary(result.raw.summary),
    scope: projectScope(result.raw.scope),
    contentCoverage: lower(result.raw.contentCoverage),
    files: result.raw.files.map((file) => projectFile(file, options.view)),
    hasMoreFiles: result.raw.hasMoreFiles,
  };

  if (result.raw.contentFailure != null) {
    envelope.contentFailure = projectContentFailure(result.raw.contentFailure);
  }
  return envelope;
}

function buildTarget(
  result: CodeDiffResult,
  target: CodeDiffParams["target"],
): LeanCodeDiffTarget {
  if ("registry" in target) {
    const packageInfo = result.package;
    return {
      kind: "package",
      registry: lower(packageInfo?.registry ?? target.registry),
      name: packageInfo?.name ?? target.packageName,
      ...(packageInfo?.repoUrl != null ? { repoUrl: packageInfo.repoUrl } : {}),
    };
  }
  return { kind: "repository", repoUrl: target.repoUrl };
}

function projectResolution(
  resolution: CodeDiffResult["fromResolution"],
): LeanCodeDiffResolution {
  const projected: LeanCodeDiffResolution = {
    requested: resolution.requested,
    ref: resolution.ref,
    commitSha: resolution.commitSha,
    refKind: lower(resolution.refKind),
  };
  if (resolution.resolvedVersion != null) {
    projected.resolvedVersion = resolution.resolvedVersion;
  }
  if (resolution.versionSource != null) {
    projected.versionSource = lower(resolution.versionSource);
  }
  return projected;
}

function projectSummary(
  summary: CodeDiffResult["raw"]["summary"],
): LeanCodeDiffSummary {
  return {
    filesChanged: summary.filesChanged,
    added: summary.added,
    deleted: summary.deleted,
    modified: summary.modified,
    modeChanged: summary.modeChanged,
    typeChanged: summary.typeChanged,
    inventoryComplete: summary.inventoryComplete,
    unprojectableFiles: summary.unprojectableFiles,
  };
}

function projectScope(
  scope: CodeDiffResult["raw"]["scope"],
): LeanCodeDiffScope {
  const projected: LeanCodeDiffScope = { status: lower(scope.status) };
  if (scope.fromSubpath != null) projected.fromSubpath = scope.fromSubpath;
  if (scope.toSubpath != null) projected.toSubpath = scope.toSubpath;
  if (scope.pathPrefix != null) projected.pathPrefix = scope.pathPrefix;
  if (scope.pathGlob != null) projected.pathGlob = scope.pathGlob;
  return projected;
}

function projectContentFailure(
  failure: NonNullable<CodeDiffResult["raw"]["contentFailure"]>,
): LeanCodeDiffContentFailure {
  const projected: LeanCodeDiffContentFailure = {
    code: failure.code,
    retryable: failure.retryable,
  };
  if (failure.retryAfterMs != null) {
    projected.retryAfterMs = failure.retryAfterMs;
  }
  if (failure.stage != null) projected.stage = failure.stage;
  if (failure.limitKind != null) projected.limitKind = failure.limitKind;
  return projected;
}

function projectFile(
  file: RawCodeDiffFile,
  view: CodeDiffView,
): LeanCodeDiffFile {
  const base: LeanCodeDiffFileBase = {
    path: file.path,
    pathEncoding: lower(file.pathEncoding),
  };
  if (view === "name-only") return base;

  const nameStatus: LeanCodeDiffNameStatusFile = {
    ...base,
    status: lower(file.status),
  };
  if (view === "name-status") return nameStatus;

  const stat: LeanCodeDiffStatFile = {
    ...nameStatus,
    modeChanged: file.modeChanged,
    typeChanged: file.typeChanged,
    contentStatus: lower(file.contentStatus),
  };
  if (file.additions != null) stat.additions = file.additions;
  if (file.deletions != null) stat.deletions = file.deletions;
  if (view === "stat") return stat;

  const patch: LeanCodeDiffPatchFile = {
    ...stat,
    contentSafety: {
      filtered: file.contentSafety.filtered,
      modifications: file.contentSafety.modifications.map(lower),
    },
  };
  if (file.patch != null) {
    patch.patch = bindPatchHeaders(file.patch, file.path, patch.status);
  }
  if (file.contentOmissionReason != null) {
    patch.contentOmissionReason = file.contentOmissionReason;
  }
  return patch;
}

/** Bind the raw diff service's content-only placeholders to its owning file. */
function bindPatchHeaders(
  patch: string,
  path: string,
  status: CodeDiffEnvelopeFileStatus,
): string {
  const firstEnd = patch.indexOf("\n");
  if (firstEnd < 0) return patch;
  const secondStart = firstEnd + 1;
  const secondEnd = patch.indexOf("\n", secondStart);
  if (secondEnd < 0) return patch;

  const originalFrom = patch.slice(0, firstEnd);
  const originalTo = patch.slice(secondStart, secondEnd);
  if (originalFrom !== "--- a/file" && originalTo !== "+++ b/file") {
    return patch;
  }

  const fromPath = status === "added" ? "/dev/null" : quoteGitPath(`a/${path}`);
  const toPath = status === "deleted" ? "/dev/null" : quoteGitPath(`b/${path}`);
  const from = originalFrom === "--- a/file" ? `--- ${fromPath}` : originalFrom;
  const to = originalTo === "+++ b/file" ? `+++ ${toPath}` : originalTo;
  return `${from}\n${to}\n${patch.slice(secondEnd + 1)}`;
}

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}
