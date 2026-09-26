import type {
  ListAvailableVersion,
  ListBrowseAction,
  ListEntry,
  ListIndexingEstimate,
  ListParams,
  ListReadAction,
  ListResolution,
  ListResult,
  ListSiteJob,
  ListSiteWait,
  ListTargetIdentity,
  ListTargetResolution,
} from "@githits/core-internal";
import { colorize } from "./colors.js";
import { shellQuoteExact } from "./shell-quote.js";
import { padTerminalEnd, terminalWidth } from "./terminal-width.js";

const SEP = " | ";

export interface FormatListTextOptions {
  surface: "cli" | "mcp";
  verbose: boolean;
  useColors: boolean;
  width?: number;
}

/** Render one compact inventory view with reusable backend-authored actions. */
export function formatListText(
  result: ListResult,
  params: ListParams,
  options: FormatListTextOptions,
): string {
  const lines = [formatHeader(result, options)];
  const groupedReadTarget = findSharedSourceReadTarget(result);
  if (groupedReadTarget !== undefined) {
    const groupedReadNeedsEndOfOptions =
      startsWithDash(groupedReadTarget) ||
      result.entries.some(
        (entry) =>
          entry.kind === "FILE" &&
          entry.read?.target === groupedReadTarget &&
          entry.read.path?.startsWith("-") === true,
      );
    lines.push(
      `Read target: ${renderReadTarget(
        groupedReadTarget,
        options.surface,
        groupedReadNeedsEndOfOptions,
      )}`,
    );
  }

  const rowLabels = result.entries.map((entry) =>
    sanitizeText(plainRowLabel(entry)),
  );
  const rowColumnWidth = alignedWidth(rowLabels, options.width);
  for (let index = 0; index < result.entries.length; index += 1) {
    const entry = result.entries[index];
    if (!entry) continue;
    lines.push(
      formatEntry(
        entry,
        rowLabels[index] ?? plainRowLabel(entry),
        rowColumnWidth,
        groupedReadTarget,
        options,
      ),
    );
  }

  if (result.entries.length === 0) {
    lines.push(formatEmptyInventory(result));
  }
  if (result.inventoryKind === "SITE") {
    appendSiteLifecycle(lines, result);
  }
  if (result.hasMore && result.nextCursor !== null) {
    lines.push(
      `Continue: ${buildContinuation(params, result.nextCursor, options)}`,
    );
  }

  return lines.join("\n");
}

function formatHeader(
  result: ListResult,
  options: FormatListTextOptions,
): string {
  const target = `requested=${stringValue(result.requestedTarget)} canonical=${stringValue(result.canonicalTarget)}`;
  const parts = [
    colorize(result.inventoryKind, "bold", options.useColors),
    target,
  ];
  if (result.inventoryKind === "SOURCE" && options.verbose) {
    parts.push(
      `indexedVersion=${stringValue(result.indexedVersion)} codeIndexState=${stringValue(result.codeIndexState)} indexingStatus=${stringValue(result.indexingStatus)} indexingRef=${stringValue(result.indexingRef)}`,
    );
    if (result.resolution !== undefined) {
      parts.push(`resolution=${formatResolution(result.resolution)}`);
    }
    if (result.targetResolution !== undefined) {
      parts.push(
        `targetResolution=${formatTargetResolution(result.targetResolution)}`,
      );
    }
    if (result.availableVersions !== undefined) {
      parts.push(
        `availableVersions=${formatVersions(result.availableVersions)}`,
      );
    }
    if (result.indexingEstimate !== undefined) {
      parts.push(`indexingEstimate=${formatEstimate(result.indexingEstimate)}`);
    }
  }
  parts.push(
    `${result.entries.length} ${result.entries.length === 1 ? "entry" : "entries"}`,
  );
  return parts.join(SEP);
}

function formatEntry(
  entry: ListEntry,
  plainLabel: string,
  rowColumnWidth: number,
  groupedReadTarget: string | undefined,
  options: FormatListTextOptions,
): string {
  const paddedLabel =
    rowColumnWidth > 0
      ? padTerminalEnd(plainLabel, rowColumnWidth)
      : plainLabel;
  const kind = colorize(entry.kind, "cyan", options.useColors);
  const label = `${kind}${paddedLabel.slice(entry.kind.length)}`;
  const parts = [label];

  if (entry.kind === "PAGE" && entry.title !== null) {
    parts.push(`title=${stringValue(entry.title)}`);
  }
  if (options.verbose && entry.kind === "FILE") {
    appendSourceEntryDetails(parts, entry);
  }

  if (entry.read !== null) {
    parts.push(
      groupedReadTarget !== undefined &&
        entry.kind === "FILE" &&
        entry.read.target === groupedReadTarget
        ? formatGroupedReadPath(entry.read, options.surface)
        : `read: ${renderReadAction(entry.read, options.surface)}`,
    );
  }
  if (entry.browse !== null) {
    parts.push(`browse: ${renderBrowseAction(entry.browse, options.surface)}`);
  }

  return parts.join(SEP);
}

function plainRowLabel(entry: ListEntry): string {
  const path =
    entry.path === null ? "null" : JSON.stringify(sanitizeText(entry.path));
  return `${entry.kind} ${path}`;
}

function alignedWidth(labels: string[], width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return 0;
  const widest = labels.reduce(
    (maximum, label) => Math.max(maximum, terminalWidth(label)),
    0,
  );
  return widest + 2 <= width ? widest : 0;
}

function findSharedSourceReadTarget(result: ListResult): string | undefined {
  if (result.inventoryKind !== "SOURCE") return undefined;
  const files = result.entries.filter(
    (entry) => entry.kind === "FILE" && entry.read !== null,
  );
  if (files.length < 2) return undefined;
  const target = files[0]?.read?.target;
  if (
    target === undefined ||
    containsNul([target]) ||
    files.some(
      (entry) =>
        entry.read?.target !== target ||
        entry.read.path?.includes("\u0000") === true,
    )
  ) {
    return undefined;
  }
  return target;
}

function renderReadTarget(
  target: string,
  surface: FormatListTextOptions["surface"],
  needsEndOfOptions = false,
): string {
  if (surface === "mcp") return `read target=${jsonValue(target)}`;
  if (containsNul([target])) {
    return `read target=${jsonValue(target)} (not shell-executable: contains NUL)`;
  }
  return [
    "githits read",
    ...(needsEndOfOptions || startsWithDash(target) ? ["--"] : []),
    shellQuoteExact(target),
  ].join(" ");
}

function formatGroupedReadPath(
  action: ListReadAction,
  surface: FormatListTextOptions["surface"],
): string {
  if (action.path === null || action.path === undefined)
    return "read path=null";
  if (surface === "mcp") return `read path=${jsonValue(action.path)}`;
  if (containsNul([action.path])) {
    return `read path=${jsonValue(action.path)} (not shell-executable: contains NUL)`;
  }
  return `read path ${shellQuoteExact(action.path)}`;
}

function renderReadAction(
  action: ListReadAction,
  surface: FormatListTextOptions["surface"],
): string {
  if (surface === "cli") {
    if (
      containsNul([
        action.target,
        ...(action.path === undefined || action.path === null
          ? []
          : [action.path]),
      ])
    ) {
      return [
        `read target=${jsonValue(action.target)}`,
        ...(action.path !== undefined
          ? [`path=${action.path === null ? "null" : jsonValue(action.path)}`]
          : []),
        "(not shell-executable: contains NUL)",
      ].join(" ");
    }
    const positionals = [
      action.target,
      ...(action.path !== undefined && action.path !== null
        ? [action.path]
        : []),
    ];
    return [
      "githits read",
      ...(positionals.some(startsWithDash) ? ["--"] : []),
      ...positionals.map((value) => shellQuoteExact(value)),
    ].join(" ");
  }
  return [
    `read target=${jsonValue(action.target)}`,
    ...(action.path !== undefined && action.path !== null
      ? [`path=${jsonValue(action.path)}`]
      : []),
  ].join(" ");
}

function renderBrowseAction(
  action: ListBrowseAction,
  surface: FormatListTextOptions["surface"],
): string {
  if (surface === "cli") {
    const actionPaths =
      action.paths === undefined || action.paths === null ? [] : action.paths;
    if (containsNul([action.target, ...actionPaths])) {
      return [
        `list target=${jsonValue(action.target)}`,
        ...(action.paths !== undefined
          ? [
              `paths=${
                action.paths === null ? "null" : jsonArray(action.paths)
              }`,
            ]
          : []),
        "(not shell-executable: contains NUL)",
      ].join(" ");
    }
    const operands = [action.target, ...actionPaths];
    return [
      "githits list",
      ...(operands.some(startsWithDash) ? ["--"] : []),
      ...operands.map((operand) => shellQuoteExact(operand)),
    ].join(" ");
  }
  return [
    `list target=${jsonValue(action.target)}`,
    ...(action.paths !== undefined && action.paths !== null
      ? [`paths=${jsonArray(action.paths)}`]
      : []),
  ].join(" ");
}

function appendSourceEntryDetails(parts: string[], entry: ListEntry): void {
  for (const field of ["language", "fileType", "intent"] as const) {
    const value = entry[field];
    if (value !== undefined) parts.push(`${field}=${stringValue(value)}`);
  }
  for (const field of ["byteSize", "lineCount"] as const) {
    const value = entry[field];
    if (value !== undefined) parts.push(`${field}=${numberValue(value)}`);
  }
  if (entry.contentHash !== undefined) {
    parts.push(`contentHash=${stringValue(entry.contentHash)}`);
  }
}

function formatEmptyInventory(result: ListResult): string {
  if (result.inventoryKind === "SOURCE") {
    return result.indexingStatus === "INDEXING" ||
      result.codeIndexState === "INDEXING"
      ? "Source index is INDEXING; no entries are available yet."
      : "No entries matched.";
  }
  return "No pages are currently listed.";
}

function appendSiteLifecycle(lines: string[], result: ListResult): void {
  const preparation =
    result.preparation === null
      ? "null"
      : `selected=${result.preparation.selected} enqueued=${result.preparation.enqueued} activeJobs=${formatJobs(result.preparation.activeJobs)} awaited=${formatWaits(result.preparation.awaited)}`;
  lines.push(
    `Site lifecycle: inventory=${stringValue(result.inventoryState)} crawl=${stringValue(result.crawlStatus)} coverage=${stringValue(result.coverageState)} reason=${stringValue(result.coverageReason)} preparation=${preparation}`,
  );
}

function formatResolution(resolution: ListResolution | null): string {
  if (resolution === null) return "null";
  return `{requestedVersion=${stringValue(resolution.requestedVersion)}, requestedRef=${stringValue(resolution.requestedRef)}, resolvedRef=${stringValue(resolution.resolvedRef)}, commitSha=${stringValue(resolution.commitSha)}}`;
}

function formatTargetResolution(
  resolution: ListTargetResolution | null,
): string {
  if (resolution === null) return "null";
  return `{requested=${formatIdentity(resolution.requested)}, resolvedRequested=${formatIdentity(resolution.resolvedRequested)}, served=${formatIdentity(resolution.served)}, freshness=${stringValue(resolution.freshness)}, freshnessReason=${stringValue(resolution.freshnessReason)}, indexingRef=${stringValue(resolution.indexingRef)}, availableVersions=${formatVersions(resolution.availableVersions)}, availableRefs=${formatVersions(resolution.availableRefs)}, suggestedRefs=${formatVersions(resolution.suggestedRefs)}}`;
}

function formatIdentity(identity: ListTargetIdentity | null): string {
  if (identity === null) return "null";
  return `{kind=${stringValue(identity.kind)}, registry=${stringValue(identity.registry)}, packageName=${stringValue(identity.packageName)}, version=${stringValue(identity.version)}, repoUrl=${stringValue(identity.repoUrl)}, gitRef=${stringValue(identity.gitRef)}, commitSha=${stringValue(identity.commitSha)}}`;
}

function formatVersions(versions: ListAvailableVersion[] | null): string {
  if (versions === null) return "null";
  return `[${versions
    .map(
      (version) =>
        `{version=${stringValue(version.version)}, ref=${stringValue(version.ref)}}`,
    )
    .join(", ")}]`;
}

function formatEstimate(estimate: ListIndexingEstimate | null): string {
  if (estimate === null) return "null";
  return `{lowerSeconds=${numberValue(estimate.lowerSeconds)}, upperSeconds=${numberValue(estimate.upperSeconds)}, elapsedSeconds=${numberValue(estimate.elapsedSeconds)}, sampleCount=${numberValue(estimate.sampleCount)}, source=${stringValue(estimate.source)}}`;
}

function formatJobs(jobs: ListSiteJob[]): string {
  return `[${jobs
    .map((job) => `${stringValue(job.mode)}/${stringValue(job.state)}`)
    .join(", ")}]`;
}

function formatWaits(waits: ListSiteWait[]): string {
  return `[${waits
    .map((wait) => `${stringValue(wait.mode)}/${stringValue(wait.outcome)}`)
    .join(", ")}]`;
}

function buildContinuation(
  params: ListParams,
  cursor: string,
  options: FormatListTextOptions,
): string {
  return options.surface === "cli"
    ? buildCliContinuation(params, cursor, options.verbose)
    : buildMcpContinuation(params, cursor);
}

function buildCliContinuation(
  params: ListParams,
  cursor: string,
  verbose: boolean,
): string {
  const paths = params.paths ?? [];
  if (
    containsNul([
      params.target,
      ...paths,
      ...(params.fileTypes ?? []),
      ...(params.languages ?? []),
      ...(params.intents ?? []),
      cursor,
    ])
  ) {
    return buildNonExecutableCliContinuation(params, cursor, verbose);
  }

  const positionals = [params.target, ...paths];
  const quotedPositionals = positionals.map((value) => shellQuoteExact(value));
  const options: string[] = [];
  if (params.recursive) options.push("--recursive");
  appendCliRepeated(options, "--file-type", params.fileTypes);
  appendCliRepeated(options, "--language", params.languages);
  appendCliRepeated(options, "--intent", params.intents);
  if (params.limit !== undefined) {
    options.push("--limit", String(params.limit));
  }
  options.push("--after", shellQuoteExact(cursor));
  if (params.waitTimeoutMs !== undefined) {
    options.push("--wait", String(params.waitTimeoutMs));
  }
  if (verbose) options.push("--verbose");

  return positionals.some(startsWithDash)
    ? ["githits list", ...options, "--", ...quotedPositionals].join(" ")
    : ["githits list", ...quotedPositionals, ...options].join(" ");
}

function buildNonExecutableCliContinuation(
  params: ListParams,
  cursor: string,
  verbose: boolean,
): string {
  const fields = [`target=${jsonValue(params.target)}`];
  if (params.paths && params.paths.length > 0) {
    fields.push(`paths=${jsonArray(params.paths)}`);
  }
  if (params.recursive) fields.push("recursive=true");
  if (params.fileTypes && params.fileTypes.length > 0) {
    fields.push(`fileTypes=${jsonArray(params.fileTypes)}`);
  }
  if (params.languages && params.languages.length > 0) {
    fields.push(`languages=${jsonArray(params.languages)}`);
  }
  if (params.intents && params.intents.length > 0) {
    fields.push(`intents=${jsonArray(params.intents)}`);
  }
  if (params.limit !== undefined) fields.push(`limit=${params.limit}`);
  fields.push(`after=${jsonValue(cursor)}`);
  if (params.waitTimeoutMs !== undefined) {
    fields.push(`waitTimeoutMs=${params.waitTimeoutMs}`);
  }
  if (verbose) fields.push("verbose=true");
  return `list ${fields.join(" ")} (not shell-executable: contains NUL)`;
}

function appendCliRepeated(
  parts: string[],
  option: string,
  values: readonly string[] | undefined,
): void {
  if (!values) return;
  for (const value of values) {
    parts.push(option, shellQuoteExact(value));
  }
}

function buildMcpContinuation(params: ListParams, cursor: string): string {
  const args = [`target=${jsonValue(params.target)}`];
  if (params.paths && params.paths.length > 0) {
    args.push(`paths=${jsonArray(params.paths)}`);
  }
  if (params.recursive !== undefined) {
    args.push(`recursive=${String(params.recursive)}`);
  }
  if (params.fileTypes && params.fileTypes.length > 0) {
    args.push(`file_types=${jsonArray(params.fileTypes)}`);
  }
  if (params.languages && params.languages.length > 0) {
    args.push(`languages=${jsonArray(params.languages)}`);
  }
  if (params.intents && params.intents.length > 0) {
    args.push(`intents=${jsonArray(params.intents)}`);
  }
  if (params.limit !== undefined) args.push(`limit=${params.limit}`);
  args.push(`after=${jsonValue(cursor)}`);
  if (params.waitTimeoutMs !== undefined) {
    args.push(`wait_timeout_ms=${params.waitTimeoutMs}`);
  }
  return `list ${args.join(" ")}`;
}

function jsonArray(values: readonly string[]): string {
  return `[${values.map((value) => jsonValue(value)).join(", ")}]`;
}

function stringValue(value: string | null): string {
  return value === null ? "null" : jsonValue(value);
}

function numberValue(value: number | null): string {
  return value === null ? "null" : String(value);
}

function jsonValue(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f]/gu, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  });
}

function containsNul(values: readonly string[]): boolean {
  return values.some((value) => value.includes("\u0000"));
}

function startsWithDash(value: string): boolean {
  return value.startsWith("-");
}

function sanitizeText(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      sanitized += `\\u{${codePoint.toString(16)}}`;
    } else {
      sanitized += character;
    }
  }
  return sanitized;
}
